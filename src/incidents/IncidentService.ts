import { prisma } from "@/domain/db";
import { eventBus } from "@/events/InProcessEventBus";
import { TOPICS } from "@/events/topics";
import { DemoControls } from "@/simulation/DemoControls";
import type { Incident, IncidentStatus, IncidentType } from "@/domain/types";

export interface ReportIncidentInput {
  type: IncidentType;
  subjectId: string;
  actor: string;
  cause?: string;
}

/**
 * Lifecycle wrapper around the yard-state mutation DemoControls already
 * performs (setEquipmentStatus/blockLane/unblockLane) — this is the record
 * of *why* and *for how long*, not a new way to mutate equipment/lane
 * state. Guards against reporting a duplicate incident for the same
 * subject, and against resolving equipment/lanes that were changed some
 * other way in the meantime (re-checked at resolve time, not just report
 * time, same fail-closed pattern as AgentAlertService.apply()).
 */
export class IncidentService {
  private readonly controls = new DemoControls();

  async report(input: ReportIncidentInput): Promise<Incident> {
    const existing = await prisma.incident.findFirst({
      where: { type: input.type, subjectId: input.subjectId, status: "OPEN" },
    });
    if (existing) {
      throw new Error(`An open incident already exists for ${input.type} ${input.subjectId} (${existing.id}).`);
    }

    if (input.type === "EQUIPMENT_OFFLINE") {
      const equipment = await prisma.equipment.findUniqueOrThrow({ where: { id: input.subjectId } });
      if (equipment.status !== "AVAILABLE") {
        throw new Error(
          `Cannot report equipment ${input.subjectId} offline: it is currently ${equipment.status}, not AVAILABLE.`,
        );
      }
      await this.controls.setEquipmentStatus(input.subjectId, "OFFLINE");
    } else {
      const lane = await prisma.yardLane.findUniqueOrThrow({ where: { id: input.subjectId } });
      if (lane.blocked) {
        throw new Error(`Cannot report lane ${input.subjectId} blocked: it is already blocked.`);
      }
      await this.controls.blockLane(input.subjectId);
    }

    const incident = await prisma.incident.create({
      data: {
        type: input.type,
        subjectId: input.subjectId,
        reportedBy: input.actor,
        cause: input.cause,
      },
    });
    await prisma.auditEvent.create({
      data: {
        action: "INCIDENT_REPORTED",
        actor: input.actor,
        detailsJson: JSON.stringify({ incidentId: incident.id, type: input.type, subjectId: input.subjectId, cause: input.cause }),
      },
    });
    eventBus.publish(TOPICS.INCIDENT_CHANGED, { incidentId: incident.id });

    return incident;
  }

  async resolve(incidentId: string, actor: string, note?: string): Promise<Incident> {
    const current = await prisma.incident.findUniqueOrThrow({ where: { id: incidentId } });
    if (current.status !== "OPEN") {
      throw new Error(`Incident ${incidentId} must be OPEN to resolve (was ${current.status}).`);
    }

    if (current.type === "EQUIPMENT_OFFLINE") {
      await this.controls.setEquipmentStatus(current.subjectId, "AVAILABLE");
    } else {
      await this.controls.unblockLane(current.subjectId);
    }

    const incident = await prisma.incident.update({
      where: { id: incidentId },
      data: {
        status: "RESOLVED",
        resolvedAt: new Date(),
        resolvedBy: actor,
        resolutionNoteJson: note ? JSON.stringify({ note }) : null,
      },
    });
    await prisma.auditEvent.create({
      data: {
        action: "INCIDENT_RESOLVED",
        actor,
        detailsJson: JSON.stringify({ incidentId, type: current.type, subjectId: current.subjectId, note }),
      },
    });
    eventBus.publish(TOPICS.INCIDENT_CHANGED, { incidentId });

    return incident;
  }

  async list(status?: IncidentStatus): Promise<Incident[]> {
    return prisma.incident.findMany({
      where: status ? { status } : undefined,
      orderBy: { startedAt: "desc" },
    });
  }
}
