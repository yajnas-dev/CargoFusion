import { prisma } from "@/domain/db";
import { eventBus } from "@/events/InProcessEventBus";
import { TOPICS } from "@/events/topics";
import { MockTOSAdapter } from "@/adapters/tos/MockTOSAdapter";
import { SupervisorApprovalService } from "@/approval/SupervisorApprovalService";
import { WorkerTaskService } from "@/worker/WorkerTaskService";
import { DemoControls } from "@/simulation/DemoControls";
import type { AgentAlert, AgentAlertStatus } from "@/domain/types";
import type { RankedAlert } from "@/agent-monitor/types";

const AGENT_ACTOR = "agent:container-management-agent";

export interface ApplyResult {
  alert: AgentAlert;
  result: unknown;
}

/**
 * Persistence layer for agent-raised alerts, and the single place the
 * fixed suggested-action taxonomy is dispatched to real deterministic
 * service calls on Apply — this is where "the agent never autonomously
 * executes anything" is actually enforced in code. Every raise/apply/
 * dismiss writes the same immutable AuditEvent trail every other action
 * in the system gets.
 */
export class AgentAlertService {
  /** Persists new alerts, skipping any whose dedupeKey already has an OPEN/ACKNOWLEDGED alert. */
  async raiseBatch(ranked: RankedAlert[]): Promise<AgentAlert[]> {
    const created: AgentAlert[] = [];

    for (const { candidate, rankScore, explanation } of ranked) {
      const existing = await prisma.agentAlert.findFirst({
        where: { dedupeKey: candidate.dedupeKey, status: { in: ["OPEN", "ACKNOWLEDGED"] } },
      });
      if (existing) continue;

      const alert = await prisma.agentAlert.create({
        data: {
          type: candidate.type,
          severity: candidate.severity,
          taskId: candidate.taskId,
          dedupeKey: candidate.dedupeKey,
          subjectJson: JSON.stringify(candidate.subject),
          suggestedActionType: candidate.suggestedActionType,
          suggestedActionPayloadJson: JSON.stringify(candidate.suggestedActionPayload),
          rankScore,
          explanation,
        },
      });
      await prisma.auditEvent.create({
        data: {
          taskId: candidate.taskId,
          agentAlertId: alert.id,
          action: "AGENT_ALERT_RAISED",
          actor: AGENT_ACTOR,
          detailsJson: JSON.stringify({ type: candidate.type, dedupeKey: candidate.dedupeKey }),
        },
      });
      eventBus.publish(TOPICS.AGENT_ALERT_RAISED, alert);
      created.push(alert);
    }

    return created;
  }

  async list(status?: AgentAlertStatus): Promise<AgentAlert[]> {
    return prisma.agentAlert.findMany({
      where: status ? { status } : undefined,
      orderBy: { detectedAt: "desc" },
    });
  }

  async listOpen(): Promise<AgentAlert[]> {
    return this.list("OPEN");
  }

  async acknowledge(alertId: string, actor: string): Promise<AgentAlert> {
    const current = await prisma.agentAlert.findUniqueOrThrow({ where: { id: alertId } });
    if (current.status !== "OPEN") {
      throw new Error(`Alert ${alertId} must be OPEN to acknowledge (was ${current.status}).`);
    }
    const alert = await prisma.agentAlert.update({ where: { id: alertId }, data: { status: "ACKNOWLEDGED" } });
    await prisma.auditEvent.create({
      data: {
        taskId: current.taskId,
        agentAlertId: alertId,
        action: "STATUS_CHANGED",
        actor,
        detailsJson: JSON.stringify({ field: "agentAlert.status", from: "OPEN", to: "ACKNOWLEDGED" }),
      },
    });
    return alert;
  }

  /**
   * Dispatches the alert's suggested action to the one deterministic
   * service method it maps to. ESCALATE_TO_SUPERVISOR has no automated
   * action by design — there is no safe deterministic fix for "this
   * needs a human's judgment," so it throws rather than pretending to
   * apply something. Fails closed: if the underlying service call
   * throws (e.g. the override re-validation rejects it), the alert stays
   * OPEN/ACKNOWLEDGED and the error propagates.
   */
  async apply(alertId: string, actor: string): Promise<ApplyResult> {
    const current = await prisma.agentAlert.findUniqueOrThrow({ where: { id: alertId } });
    if (current.status !== "OPEN" && current.status !== "ACKNOWLEDGED") {
      throw new Error(`Alert ${alertId} must be OPEN or ACKNOWLEDGED to apply (was ${current.status}).`);
    }

    const payload = JSON.parse(current.suggestedActionPayloadJson);
    const tos = new MockTOSAdapter();
    let result: unknown;

    switch (current.suggestedActionType) {
      case "UNBLOCK_LANE":
        result = await new DemoControls().unblockLane(payload.laneId);
        break;
      case "REASSIGN_EQUIPMENT":
        result = await new SupervisorApprovalService(tos).override(
          payload.taskId,
          actor,
          "Agent-suggested equipment reassignment",
          { equipmentId: payload.equipmentId },
        );
        break;
      case "REPRIORITIZE_TASK":
        result = await new SupervisorApprovalService(tos).reprioritize(payload.taskId, actor, payload.newPriority);
        break;
      case "FREE_STUCK_EQUIPMENT":
        result = await new WorkerTaskService().releaseEquipment(payload.equipmentId, actor);
        break;
      case "ESCALATE_TO_SUPERVISOR":
        throw new Error("ESCALATE_TO_SUPERVISOR has no automated action — dismiss it once handled.");
      default:
        throw new Error(`Unknown suggested action type: ${current.suggestedActionType}`);
    }

    const alert = await prisma.agentAlert.update({
      where: { id: alertId },
      data: { status: "APPLIED", resolvedAt: new Date(), resolvedBy: actor },
    });
    await prisma.auditEvent.create({
      data: {
        taskId: current.taskId,
        agentAlertId: alertId,
        action: "AGENT_ALERT_APPLIED",
        actor,
        detailsJson: JSON.stringify({ suggestedActionType: current.suggestedActionType, payload }),
      },
    });
    eventBus.publish(TOPICS.AGENT_ALERT_RESOLVED, alert);

    return { alert, result };
  }

  async dismiss(alertId: string, actor: string, reason?: string): Promise<AgentAlert> {
    const current = await prisma.agentAlert.findUniqueOrThrow({ where: { id: alertId } });
    if (current.status !== "OPEN" && current.status !== "ACKNOWLEDGED") {
      throw new Error(`Alert ${alertId} must be OPEN or ACKNOWLEDGED to dismiss (was ${current.status}).`);
    }

    const alert = await prisma.agentAlert.update({
      where: { id: alertId },
      data: {
        status: "DISMISSED",
        resolvedAt: new Date(),
        resolvedBy: actor,
        resolutionNoteJson: reason ? JSON.stringify({ reason }) : null,
      },
    });
    await prisma.auditEvent.create({
      data: {
        taskId: current.taskId,
        agentAlertId: alertId,
        action: "AGENT_ALERT_DISMISSED",
        actor,
        detailsJson: JSON.stringify({ reason }),
      },
    });
    eventBus.publish(TOPICS.AGENT_ALERT_RESOLVED, alert);

    return alert;
  }
}
