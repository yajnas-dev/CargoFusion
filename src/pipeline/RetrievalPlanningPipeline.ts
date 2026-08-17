import type { TOSAdapter } from "@/adapters/tos/TOSAdapter";
import { ContainerSearchService, type ContainerMatch } from "@/search/ContainerSearchService";
import { EquipmentAllocationService, type EquipmentScore } from "@/optimization/EquipmentAllocationService";
import { RouteOptimizationService, type Route } from "@/optimization/RouteOptimizationService";
import { DigitalTwin, type ValidationResult } from "@/twin/DigitalTwin";
import type { Container, EquipmentType, Priority } from "@/domain/types";

// A search hit this confident is treated as the one the user meant, even
// if other lower-confidence candidates also came back — avoids flagging
// every fuzzy noise match as ambiguous.
const UNAMBIGUOUS_CONFIDENCE = 1;

// Bounds how many equipment candidates the self-correction retry will try
// before giving up and surfacing the conflict for a human/agent to see.
const MAX_EQUIPMENT_ATTEMPTS = 5;

export type PlanStatus =
  | "READY" // container resolved, route+equipment+twin all check out
  | "AMBIGUOUS" // multiple plausible container matches, none clearly the one
  | "NOT_FOUND" // no container matched the query at all
  | "NO_EQUIPMENT" // no eligible equipment (type/availability/capacity/reachability)
  | "NO_ROUTE" // no path exists between any candidate equipment and the container
  | "NEEDS_ESCALATION"; // twin validation failed in a way retrying can't fix

export interface RetrievalRequest {
  containerQuery: string;
  requestedBy: string;
  priority: Priority;
  requiredEquipmentType?: EquipmentType;
}

export interface RetrievalPlanResult {
  status: PlanStatus;
  request: RetrievalRequest;
  containerMatches: ContainerMatch[];
  container?: Container;
  equipmentCandidates?: EquipmentScore[];
  selectedEquipment?: EquipmentScore;
  // Cranes that could service this container's block, ranked same as
  // equipmentCandidates. Populated whenever the primary allocation isn't
  // already for a crane (undefined = not computed, e.g. NOT_FOUND/AMBIGUOUS
  // before a block is even known; [] = computed but none available).
  craneCandidates?: EquipmentScore[];
  route?: Route;
  twin?: ValidationResult;
}

const DEFAULT_EQUIPMENT_TYPE: EquipmentType = "YARD_TRUCK";

/**
 * Deterministic composition of search + equipment allocation + route
 * optimization + digital-twin validation into a single retrieval plan
 * (report section 5's flow, minus the AI orchestration and human-approval
 * steps that come in Phase 10+). The future agent orchestrator calls this
 * rather than re-wiring search/route/allocation/twin itself.
 */
export class RetrievalPlanningPipeline {
  private readonly search: ContainerSearchService;
  private readonly allocation: EquipmentAllocationService;
  private readonly routes: RouteOptimizationService;
  private readonly twin: DigitalTwin;

  constructor(tos: TOSAdapter) {
    this.search = new ContainerSearchService(tos);
    this.allocation = new EquipmentAllocationService(tos);
    this.routes = new RouteOptimizationService(tos);
    this.twin = new DigitalTwin(tos);
  }

  async plan(request: RetrievalRequest): Promise<RetrievalPlanResult> {
    const searchResult = await this.search.search(request.containerQuery);

    if (searchResult.matches.length === 0) {
      return { status: "NOT_FOUND", request, containerMatches: [] };
    }

    const container = this.resolveContainer(searchResult.matches);
    if (!container) {
      return { status: "AMBIGUOUS", request, containerMatches: searchResult.matches };
    }

    const destinationNodeId = `BLOCK-${container.block}-ENTRY`;
    const requiredType = request.requiredEquipmentType ?? DEFAULT_EQUIPMENT_TYPE;

    // The requested equipment (typically a yard truck) moves the container,
    // but a crane is also needed at the block to load/unload it. Look that
    // up separately so the plan can name it even though the request wasn't
    // "for" a crane. Skip it when the request already targets a crane
    // directly — equipmentCandidates below already covers that case.
    const craneCandidates =
      requiredType === "CRANE"
        ? undefined
        : await this.allocation.allocate({
            destinationNodeId,
            requiredType: "CRANE",
            containerWeightKg: container.weightKg,
            priority: request.priority,
          });

    const equipmentCandidates = await this.allocation.allocate({
      destinationNodeId,
      requiredType,
      containerWeightKg: container.weightKg,
      priority: request.priority,
    });
    if (equipmentCandidates.length === 0) {
      return {
        status: "NO_EQUIPMENT",
        request,
        containerMatches: searchResult.matches,
        container,
        equipmentCandidates,
        craneCandidates,
      };
    }

    return this.attemptCandidates(
      request,
      searchResult.matches,
      container,
      destinationNodeId,
      equipmentCandidates,
      craneCandidates,
    );
  }

  private resolveContainer(matches: ContainerMatch[]): Container | undefined {
    if (matches.length === 1) return matches[0].container;
    if (matches[0].confidence >= UNAMBIGUOUS_CONFIDENCE) return matches[0].container;
    return undefined;
  }

  /**
   * Tries equipment candidates in ranked order until one produces a route
   * that passes digital-twin validation, self-correcting past a
   * candidate that turned out double-booked/unavailable since it was
   * scored (e.g. a concurrent request claimed it first).
   */
  private async attemptCandidates(
    request: RetrievalRequest,
    containerMatches: ContainerMatch[],
    container: Container,
    destinationNodeId: string,
    equipmentCandidates: EquipmentScore[],
    craneCandidates: EquipmentScore[] | undefined,
  ): Promise<RetrievalPlanResult> {
    let lastRoute: Route | undefined;
    let lastTwin: ValidationResult | undefined;
    let lastCandidate: EquipmentScore | undefined;
    let sawNoRoute = false;

    for (const candidate of equipmentCandidates.slice(0, MAX_EQUIPMENT_ATTEMPTS)) {
      const route = await this.routes.computeRoute(
        candidate.equipment.currentNodeId,
        destinationNodeId,
      );
      if (!route) {
        sawNoRoute = true;
        continue;
      }

      const twin = await this.twin.validatePlan({
        containerId: container.id,
        equipmentId: candidate.equipment.id,
        routeNodeIds: route.path,
      });

      lastRoute = route;
      lastTwin = twin;
      lastCandidate = candidate;

      if (twin.recommendedAction === "PROCEED") {
        return {
          status: "READY",
          request,
          containerMatches,
          container,
          equipmentCandidates,
          selectedEquipment: candidate,
          craneCandidates,
          route,
          twin,
        };
      }
      if (twin.recommendedAction === "ESCALATE") break; // not worth trying more candidates
    }

    if (!lastCandidate) {
      return {
        status: sawNoRoute ? "NO_ROUTE" : "NO_EQUIPMENT",
        request,
        containerMatches,
        container,
        equipmentCandidates,
        craneCandidates,
      };
    }

    return {
      status: "NEEDS_ESCALATION",
      request,
      containerMatches,
      container,
      equipmentCandidates,
      selectedEquipment: lastCandidate,
      craneCandidates,
      route: lastRoute,
      twin: lastTwin,
    };
  }
}
