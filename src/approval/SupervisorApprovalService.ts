import type { TOSAdapter } from "@/adapters/tos/TOSAdapter";
import { RetrievalPlanningPipeline, type RetrievalPlanResult } from "@/pipeline/RetrievalPlanningPipeline";
import { RouteOptimizationService } from "@/optimization/RouteOptimizationService";
import { DigitalTwin } from "@/twin/DigitalTwin";
import { ConfidenceGate, isReadyPlan, type ConfidenceAssessment } from "@/policy/ConfidenceGate";
import { prisma } from "@/domain/db";
import type { EquipmentType, Priority, Task, Recommendation } from "@/domain/types";

export interface SubmitRequestInput {
  containerQuery: string;
  requestedBy: string;
  priority: Priority;
  requiredEquipmentType?: EquipmentType;
  naturalLanguageRequest?: string;
}

export interface SubmitRequestResult {
  planResult: RetrievalPlanResult;
  task?: Task;
  recommendation?: Recommendation;
  confidence?: ConfidenceAssessment;
}

export interface OverrideDecision {
  equipmentId?: string;
  note?: string;
}

/**
 * Human-in-the-loop layer (report sections 8/12/14): persists a resolved
 * plan as a Task + Recommendation, then exposes Approve/Reject/Override.
 * Every action — including the initial submission — writes an immutable
 * AuditEvent, whether or not a Task ended up created (report section 14:
 * "all access decisions, both permitted and denied, logged").
 */
export class SupervisorApprovalService {
  private readonly pipeline: RetrievalPlanningPipeline;
  private readonly routes: RouteOptimizationService;
  private readonly twin: DigitalTwin;
  private readonly gate = new ConfidenceGate();

  constructor(private readonly tos: TOSAdapter) {
    this.pipeline = new RetrievalPlanningPipeline(tos);
    this.routes = new RouteOptimizationService(tos);
    this.twin = new DigitalTwin(tos);
  }

  async submitRequest(input: SubmitRequestInput): Promise<SubmitRequestResult> {
    const planResult = await this.pipeline.plan(input);

    if (!planResult.container) {
      // Nothing resolved to attach a Task to (Task.containerId is a
      // required FK) — AMBIGUOUS/NOT_FOUND need clarification before
      // there's anything to submit for approval.
      await prisma.auditEvent.create({
        data: {
          action: "REQUEST_SUBMITTED",
          actor: input.requestedBy,
          detailsJson: JSON.stringify({ containerQuery: input.containerQuery, status: planResult.status }),
        },
      });
      return { planResult };
    }

    const task = await prisma.task.create({
      data: {
        containerId: planResult.container.id,
        requestedBy: input.requestedBy,
        priority: input.priority,
        naturalLanguageRequest: input.naturalLanguageRequest,
        status: planResult.status === "READY" ? "PLANNED" : "REQUESTED",
        assignedEquipmentId: planResult.selectedEquipment?.equipment.id,
      },
    });

    await prisma.auditEvent.create({
      data: {
        taskId: task.id,
        action: "REQUEST_SUBMITTED",
        actor: input.requestedBy,
        detailsJson: JSON.stringify({ containerQuery: input.containerQuery, status: planResult.status }),
      },
    });

    if (!isReadyPlan(planResult)) {
      return { planResult, task };
    }

    const confidence = this.gate.assess(planResult);
    const recommendation = await prisma.recommendation.create({
      data: {
        taskId: task.id,
        routeJson: JSON.stringify(planResult.route.path),
        equipmentId: planResult.selectedEquipment.equipment.id,
        confidence: confidence.score,
        confidenceLevel: confidence.level,
        confidenceFactorsJson: JSON.stringify(confidence.factors),
        explanation: "", // filled in by the agent layer (Phase 10) when called from the API
        twinValidated: planResult.twin.valid,
        twinIssuesJson:
          planResult.twin.issues.length > 0 ? JSON.stringify(planResult.twin.issues) : null,
      },
    });

    await prisma.auditEvent.create({
      data: {
        taskId: task.id,
        action: "RECOMMENDATION_GENERATED",
        actor: "system",
        detailsJson: JSON.stringify({ recommendationId: recommendation.id, confidenceLevel: confidence.level }),
      },
    });

    return { planResult, task, recommendation, confidence };
  }

  async approve(taskId: string, actor: string): Promise<Task> {
    const current = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    if (current.status !== "PLANNED") {
      throw new Error(`Task ${taskId} must be PLANNED to approve (was ${current.status}).`);
    }

    const task = await prisma.task.update({
      where: { id: taskId },
      data: { status: "APPROVED" },
    });
    await prisma.auditEvent.create({
      data: { taskId, action: "APPROVED", actor, detailsJson: "{}" },
    });
    return task;
  }

  async reject(taskId: string, actor: string, reason: string): Promise<Task> {
    const current = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    if (current.status !== "PLANNED" && current.status !== "REQUESTED") {
      throw new Error(`Task ${taskId} must be PLANNED or REQUESTED to reject (was ${current.status}).`);
    }

    const task = await prisma.task.update({
      where: { id: taskId },
      data: { status: "REJECTED" },
    });
    await prisma.auditEvent.create({
      data: { taskId, action: "REJECTED", actor, detailsJson: JSON.stringify({ reason }) },
    });
    return task;
  }

  /**
   * Overrides the system recommendation with the supervisor's own
   * decision, capturing exactly what report section 12 requires: who,
   * why, the original recommendation, the new decision, and when.
   */
  async override(taskId: string, actor: string, reason: string, newDecision: OverrideDecision): Promise<Task> {
    const [originalRecommendation, currentTask] = await Promise.all([
      prisma.recommendation.findFirst({
        where: { taskId },
        orderBy: { createdAt: "desc" },
      }),
      prisma.task.findUniqueOrThrow({ where: { id: taskId } }),
    ]);
    if (currentTask.status !== "PLANNED" && currentTask.status !== "APPROVED") {
      throw new Error(`Task ${taskId} must be PLANNED or APPROVED to override (was ${currentTask.status}).`);
    }

    if (newDecision.equipmentId) {
      await this.assertEquipmentUsable(taskId, currentTask.containerId, newDecision.equipmentId);
    }

    const task = await prisma.task.update({
      where: { id: taskId },
      data: {
        status: "APPROVED",
        assignedEquipmentId: newDecision.equipmentId ?? currentTask.assignedEquipmentId,
      },
    });

    await prisma.auditEvent.create({
      data: {
        taskId,
        action: "OVERRIDDEN",
        actor,
        detailsJson: JSON.stringify({
          reason,
          originalRecommendation: originalRecommendation
            ? {
                equipmentId: originalRecommendation.equipmentId,
                routeJson: originalRecommendation.routeJson,
                confidenceLevel: originalRecommendation.confidenceLevel,
              }
            : null,
          newDecision,
          timestamp: new Date().toISOString(),
        }),
      },
    });

    return task;
  }

  /**
   * Overriding to a specific equipment id previously skipped digital-twin
   * validation entirely — a supervisor could override to equipment that's
   * offline, already double-booked, or unreachable from the container's
   * block, and it would be persisted anyway. Re-runs the same route +
   * twin check the pipeline runs for a fresh recommendation, excluding
   * this task's own reservation (`taskId`) so the check only flags a
   * *different* task already holding the new equipment.
   */
  private async assertEquipmentUsable(taskId: string, containerId: string, equipmentId: string): Promise<void> {
    const container = await this.tos.getContainer(containerId);
    if (!container) {
      throw new Error(`Cannot override task ${taskId}: container ${containerId} is not in the synced cache.`);
    }

    const [equipment] = await this.tos.getEquipment(equipmentId);
    if (!equipment) {
      throw new Error(`Cannot override to equipment ${equipmentId}: not in the synced cache.`);
    }

    const destinationNodeId = `BLOCK-${container.block}-ENTRY`;
    const route = await this.routes.computeRoute(equipment.currentNodeId, destinationNodeId);
    if (!route) {
      throw new Error(
        `Cannot override to equipment ${equipmentId}: no route from its current location to block ${container.block}.`,
      );
    }

    const validation = await this.twin.validatePlan({
      taskId,
      containerId,
      equipmentId,
      routeNodeIds: route.path,
    });
    if (validation.recommendedAction !== "PROCEED") {
      throw new Error(
        `Cannot override to equipment ${equipmentId}: ${validation.issues.map((i) => i.message).join("; ")}`,
      );
    }
  }
}
