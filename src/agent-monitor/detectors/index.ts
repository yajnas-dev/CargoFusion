import { detectBlockedLaneImpact } from "@/agent-monitor/detectors/blockedLaneImpact";
import { detectAgingTasks } from "@/agent-monitor/detectors/agingTask";
import { detectIdleEquipmentBacklog } from "@/agent-monitor/detectors/idleEquipmentBacklog";
import { detectCongestionHotspots } from "@/agent-monitor/detectors/congestionHotspot";
import { detectEquipmentTaskMismatch } from "@/agent-monitor/detectors/equipmentTaskMismatch";
import { detectUrgentUnactioned } from "@/agent-monitor/detectors/urgentContainerUnactioned";
import { detectUnclaimedPriorityContainers } from "@/agent-monitor/detectors/unclaimedPriorityContainer";
import type { DetectorFn } from "@/agent-monitor/types";

export const DETECTORS: DetectorFn[] = [
  detectBlockedLaneImpact,
  detectAgingTasks,
  detectIdleEquipmentBacklog,
  detectCongestionHotspots,
  detectEquipmentTaskMismatch,
  detectUrgentUnactioned,
  detectUnclaimedPriorityContainers,
];

export {
  detectBlockedLaneImpact,
  detectAgingTasks,
  detectIdleEquipmentBacklog,
  detectCongestionHotspots,
  detectEquipmentTaskMismatch,
  detectUrgentUnactioned,
  detectUnclaimedPriorityContainers,
};
export { resetCongestionHotspotState } from "@/agent-monitor/detectors/congestionHotspot";
