import { prisma } from "@/domain/db";
import { DemoControls } from "@/simulation/DemoControls";
import { SupervisorApprovalService } from "@/approval/SupervisorApprovalService";
import { MockTOSAdapter } from "@/adapters/tos/MockTOSAdapter";
import { ACTIVE_TASK_STATUSES } from "@/domain/constants";

export interface ScenarioDefinition {
  id: string;
  label: string;
  description: string;
}

export const SCENARIOS: ScenarioDefinition[] = [
  {
    id: "lane-blockage",
    label: "Lane Blockage",
    description: "Blocks a lane on an active task's route when one exists, otherwise a random lane.",
  },
  {
    id: "equipment-failure",
    label: "Equipment Failure",
    description: "Takes a piece of equipment offline — an in-use one if available, so the impact is immediate.",
  },
  {
    id: "congestion-spike",
    label: "Congestion Spike",
    description: "Spikes congestion on several lanes toward the agent's hotspot threshold.",
  },
  {
    id: "multiple-urgent",
    label: "Multiple Urgent Containers",
    description: "Submits several real URGENT retrieval requests at once, for exercising the Approval Queue under load.",
  },
  {
    id: "worker-shortage",
    label: "Worker Shortage",
    description: "Sets several available workers to OFF_SHIFT.",
  },
  {
    id: "multiple-disruptions",
    label: "Multiple Simultaneous Disruptions",
    description: "Runs a lane blockage and an equipment failure together.",
  },
];

export interface ScenarioResult {
  scenarioId: string;
  summary: string;
  details: Record<string, unknown>;
}

/**
 * Named, repeatable compositions of the existing DemoControls primitives
 * (Port Operations Roadmap Phase 3: Training/Validation Scenario Library)
 * — for onboarding a new supervisor or regression-testing the Container
 * Management Agent, the same way a real TOS ships a training/sandbox mode.
 * No new mutation logic beyond DemoControls.setWorkerStatus (the one gap
 * DemoControls didn't already cover); everything else composes calls that
 * already exist.
 */
export class ScenarioRunner {
  private readonly controls = new DemoControls();

  async run(scenarioId: string): Promise<ScenarioResult> {
    switch (scenarioId) {
      case "lane-blockage":
        return this.laneBlockage();
      case "equipment-failure":
        return this.equipmentFailure();
      case "congestion-spike":
        return this.congestionSpike();
      case "multiple-urgent":
        return this.multipleUrgent();
      case "worker-shortage":
        return this.workerShortage();
      case "multiple-disruptions":
        return this.multipleDisruptions();
      default:
        throw new Error(`Unknown scenario: ${scenarioId}`);
    }
  }

  private async laneBlockage(): Promise<ScenarioResult> {
    const activeTasks = await prisma.task.findMany({
      where: { status: { in: [...ACTIVE_TASK_STATUSES] } },
      include: { recommendations: { orderBy: { createdAt: "desc" }, take: 1 } },
    });

    let onActiveRouteLaneId: string | null = null;
    for (const task of activeTasks) {
      const recommendation = task.recommendations[0];
      if (!recommendation) continue;
      let path: string[];
      try {
        path = JSON.parse(recommendation.routeJson);
      } catch {
        continue;
      }
      if (path.length < 2) continue;

      const lane = await prisma.yardLane.findFirst({
        where: {
          blocked: false,
          OR: [
            { fromNodeId: path[0], toNodeId: path[1] },
            { fromNodeId: path[1], toNodeId: path[0] },
          ],
        },
      });
      if (lane) {
        onActiveRouteLaneId = lane.id;
        break;
      }
    }

    const lane = onActiveRouteLaneId
      ? await this.controls.blockLane(onActiveRouteLaneId)
      : await this.controls.blockRandomLane();

    return {
      scenarioId: "lane-blockage",
      summary: lane
        ? `Blocked lane ${lane.id}${onActiveRouteLaneId ? " (on an active task's route)" : " (random — no active task route found)"}.`
        : "No lane available to block.",
      details: { laneId: lane?.id ?? null, onActiveRoute: onActiveRouteLaneId !== null },
    };
  }

  private async equipmentFailure(): Promise<ScenarioResult> {
    const busyEquipment = await prisma.equipment.findFirst({ where: { status: "BUSY" } });
    const target = busyEquipment ?? (await prisma.equipment.findFirst({ where: { status: "AVAILABLE" } }));
    if (!target) {
      return { scenarioId: "equipment-failure", summary: "No eligible equipment found.", details: {} };
    }

    const updated = await this.controls.setEquipmentStatus(target.id, "OFFLINE");
    return {
      scenarioId: "equipment-failure",
      summary: `Equipment ${updated.id} taken offline${busyEquipment ? " (was actively in use)" : ""}.`,
      details: { equipmentId: updated.id, wasBusy: busyEquipment !== null },
    };
  }

  private async congestionSpike(): Promise<ScenarioResult> {
    const spikedLaneIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const lane = await this.controls.spikeCongestion(undefined, 2.5);
      if (lane) spikedLaneIds.push(lane.id);
    }
    return {
      scenarioId: "congestion-spike",
      summary: `Spiked congestion on ${spikedLaneIds.length} lane(s).`,
      details: { laneIds: spikedLaneIds },
    };
  }

  private async multipleUrgent(): Promise<ScenarioResult> {
    const candidates = await prisma.container.findMany({
      where: { status: "IN_YARD", retrievalEligible: true, tasks: { none: {} } },
      take: 3,
    });

    const approval = new SupervisorApprovalService(new MockTOSAdapter());
    const createdTaskIds: string[] = [];
    for (const container of candidates) {
      const { task } = await approval.submitRequest({
        containerQuery: container.id,
        requestedBy: "system:training-scenario",
        priority: "URGENT",
        naturalLanguageRequest: `[Training scenario] Get ${container.id} out urgently`,
      });
      if (task) createdTaskIds.push(task.id);
    }

    return {
      scenarioId: "multiple-urgent",
      summary: `Submitted ${createdTaskIds.length} URGENT retrieval request(s).`,
      details: { taskIds: createdTaskIds },
    };
  }

  private async workerShortage(): Promise<ScenarioResult> {
    const available = await prisma.worker.findMany({ where: { status: "AVAILABLE" }, take: 5 });
    const changedWorkerIds: string[] = [];
    for (const worker of available) {
      await this.controls.setWorkerStatus(worker.id, "OFF_SHIFT");
      changedWorkerIds.push(worker.id);
    }
    return {
      scenarioId: "worker-shortage",
      summary: `${changedWorkerIds.length} worker(s) set to OFF_SHIFT.`,
      details: { workerIds: changedWorkerIds },
    };
  }

  private async multipleDisruptions(): Promise<ScenarioResult> {
    const [lane, equipment] = await Promise.all([this.laneBlockage(), this.equipmentFailure()]);
    return {
      scenarioId: "multiple-disruptions",
      summary: `${lane.summary} ${equipment.summary}`,
      details: { laneBlockage: lane.details, equipmentFailure: equipment.details },
    };
  }
}
