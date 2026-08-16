"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./YardMap.module.css";

export interface MapNode {
  id: string;
  blockId: string | null;
  x: number;
  y: number;
}

export interface MapLane {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  blocked: boolean;
  congestionWeight: number;
}

export interface MapEquipment {
  id: string;
  type: "CRANE" | "YARD_TRUCK";
  status: "AVAILABLE" | "BUSY" | "OFFLINE";
  currentNodeId: string;
  /** Set while mid-transit (src/domain/equipmentMovement.ts) — currentNodeId is still the origin until arrival. */
  movementTargetNodeId?: string | null;
  movementStartedAt?: string | null;
  movementArrivesAt?: string | null;
}

interface Props {
  nodes: MapNode[];
  lanes: MapLane[];
  equipment: MapEquipment[];
  containerCountsByBlock: Record<string, number>;
  /** Node ids, origin -> destination, for the most recently computed route. */
  highlightPath?: string[];
  live: boolean;
  /** Toggles a lane's blocked state directly from the map — precise, operator-picked, not the random "block-lane" demo action. */
  onLaneToggle?: (lane: MapLane) => void;
  /** Extra class on the root wrapper — used by the simulation page to stretch this into a flex-sized container that fills the viewport. */
  className?: string;
}

const SCALE_X = 160;
const SCALE_Y = 340;
const PAD = 80;
const STACK_HEIGHT = 54;

// Matches the CSS custom properties in globals.css — hardcoded here since
// SVG presentation attributes can't reliably resolve var() across browsers.
const COLOR_RED = "#e5484d";
const COLOR_AMBER = "#e8a33d";
const COLOR_GREEN = "#3ecf8e";
const COLOR_ACCENT = "#2fc7d9";
const COLOR_BG = "#0a0e13";
const COLOR_MUTED = "#5c6b7d";
const COLOR_LINE = "#2a3846";

function congestionColor(weight: number, blocked: boolean): string {
  if (blocked) return COLOR_RED;
  if (weight >= 2.2) return COLOR_RED;
  if (weight >= 1.5) return COLOR_AMBER;
  return COLOR_GREEN;
}

function equipmentColor(status: MapEquipment["status"]): string {
  if (status === "AVAILABLE") return COLOR_GREEN;
  if (status === "BUSY") return COLOR_AMBER;
  return COLOR_MUTED;
}

interface EquipmentPlacement {
  px: number;
  py: number;
  inTransit: boolean;
  etaSeconds: number;
}

/** Interpolates an in-transit equipment's pixel position between its origin and target node against real elapsed time. */
function equipmentPosition(
  eq: MapEquipment,
  nodeById: Map<string, MapNode>,
  project: (n: MapNode) => { px: number; py: number },
  nowMs: number,
): EquipmentPlacement | null {
  const originNode = nodeById.get(eq.currentNodeId);
  if (!originNode) return null;
  const origin = project(originNode);

  const targetNode = eq.movementTargetNodeId ? nodeById.get(eq.movementTargetNodeId) : undefined;
  if (!targetNode || !eq.movementStartedAt || !eq.movementArrivesAt) {
    return { px: origin.px, py: origin.py, inTransit: false, etaSeconds: 0 };
  }

  const startedAt = new Date(eq.movementStartedAt).getTime();
  const arrivesAt = new Date(eq.movementArrivesAt).getTime();
  const totalMs = arrivesAt - startedAt;
  const progress = totalMs > 0 ? Math.min(1, Math.max(0, (nowMs - startedAt) / totalMs)) : 1;

  const destination = project(targetNode);
  return {
    px: origin.px + (destination.px - origin.px) * progress,
    py: origin.py + (destination.py - origin.py) * progress,
    inTransit: true,
    etaSeconds: Math.max(0, Math.round((arrivesAt - nowMs) / 1000)),
  };
}

/** requestAnimationFrame-driven clock, only ticking while `active` — avoids animating when nothing's actually moving. */
function useLiveClock(active: boolean): number {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const frame = useRef<number>(0);

  useEffect(() => {
    if (!active) return;
    const loop = () => {
      setNowMs(Date.now());
      frame.current = requestAnimationFrame(loop);
    };
    frame.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame.current);
  }, [active]);

  return nowMs;
}

/**
 * 2D top-down rendering of the actual yard graph (real node coordinates
 * and lane topology from Phase 6's A* engine) — not a decorative
 * isometric mockup. Equipment markers transition smoothly between polls
 * Equipment mid-transit (movementTargetNodeId set) is interpolated live
 * between its origin and destination node in real time against the
 * simulated arrival time — real distance-based travel duration, not a
 * fixed-length CSS snap; the route marker along a highlighted path is a
 * separate, looping visual affordance for "this is the planned route,"
 * not a live GPS feed.
 */
export default function YardMap({
  nodes,
  lanes,
  equipment,
  containerCountsByBlock,
  highlightPath,
  live,
  onLaneToggle,
  className,
}: Props) {
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const project = (n: MapNode) => ({ px: (n.x + 1) * SCALE_X + PAD, py: n.y * SCALE_Y + PAD });

  const xs = nodes.map((n) => (n.x + 1) * SCALE_X + PAD);
  const ys = nodes.map((n) => n.y * SCALE_Y + PAD);
  const width = Math.max(...xs, 100) + PAD;
  const height = Math.max(...ys, 100) + PAD + STACK_HEIGHT + 30;

  const highlightSet = new Set<string>();
  if (highlightPath) {
    for (let i = 0; i < highlightPath.length - 1; i++) {
      highlightSet.add(`${highlightPath[i]}|${highlightPath[i + 1]}`);
      highlightSet.add(`${highlightPath[i + 1]}|${highlightPath[i]}`);
    }
  }

  const routePoints =
    highlightPath && highlightPath.length > 1
      ? highlightPath
          .map((id) => nodeById.get(id))
          .filter((n): n is MapNode => n !== undefined)
          .map(project)
      : [];

  const hasEquipmentInTransit = equipment.some((e) => e.movementArrivesAt);
  const nowMs = useLiveClock(hasEquipmentInTransit);

  return (
    <div className={`${styles.wrap} ${className ?? ""}`}>
      <div className={styles.liveRow}>
        <span className={`${styles.liveDot} ${live ? styles.liveDotOn : ""}`} />
        <span>{live ? "Live simulation running" : "Static (start simulation for live drift)"}</span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        className={styles.svg}
        role="img"
        aria-label="Yard map"
      >
        {lanes.map((lane) => {
          const from = nodeById.get(lane.fromNodeId);
          const to = nodeById.get(lane.toNodeId);
          if (!from || !to) return null;
          const a = project(from);
          const b = project(to);
          const mx = (a.px + b.px) / 2;
          const my = (a.py + b.py) / 2;
          const highlighted = highlightSet.has(`${lane.fromNodeId}|${lane.toNodeId}`);
          const clickable = !!onLaneToggle;
          return (
            <g
              key={lane.id}
              className={clickable ? styles.laneGroup : undefined}
              onClick={clickable ? () => onLaneToggle!(lane) : undefined}
            >
              {clickable && (
                <line x1={a.px} y1={a.py} x2={b.px} y2={b.py} className={styles.laneHit} />
              )}
              <line
                x1={a.px}
                y1={a.py}
                x2={b.px}
                y2={b.py}
                stroke={highlighted ? COLOR_ACCENT : congestionColor(lane.congestionWeight, lane.blocked)}
                strokeWidth={highlighted ? 5 : lane.blocked ? 4 : 2}
                strokeDasharray={lane.blocked ? "7 5" : undefined}
                className={styles.lane}
              />
              {/* A distinct barrier glyph so "blocked" never reads as merely "congested" — both otherwise share red. */}
              {lane.blocked && (
                <g transform={`translate(${mx}, ${my})`} className={styles.barrierIcon}>
                  <circle r={9} fill={COLOR_BG} stroke={COLOR_RED} strokeWidth={2} />
                  <line x1={-5} y1={-5} x2={5} y2={5} stroke={COLOR_RED} strokeWidth={2} strokeLinecap="round" />
                  <line x1={-5} y1={5} x2={5} y2={-5} stroke={COLOR_RED} strokeWidth={2} strokeLinecap="round" />
                </g>
              )}
              <title>
                {lane.fromNodeId} ↔ {lane.toNodeId} · {lane.blocked ? "Blocked" : `Congestion ${lane.congestionWeight.toFixed(2)}`}
                {clickable ? ` · click to ${lane.blocked ? "unblock" : "block"}` : ""}
              </title>
            </g>
          );
        })}

        {routePoints.length > 1 && (
          <RouteMarker points={routePoints} />
        )}

        {nodes.map((node) => {
          const { px, py } = project(node);
          const isBlockEntry = node.blockId !== null;
          if (!isBlockEntry) {
            const isGate = node.id === "GATE";
            return (
              <g key={node.id}>
                {isGate ? (
                  <g transform={`translate(${px}, ${py})`}>
                    <rect x={-11} y={-11} width={22} height={22} rx={2} fill={COLOR_BG} stroke={COLOR_ACCENT} strokeWidth={1.5} />
                    <path d="M -5 4 L -5 -4 L 0 -8 L 5 -4 L 5 4" fill="none" stroke={COLOR_ACCENT} strokeWidth={1.6} strokeLinejoin="round" />
                    <line x1={-5} y1={4} x2={5} y2={4} stroke={COLOR_ACCENT} strokeWidth={1.6} />
                  </g>
                ) : (
                  <circle cx={px} cy={py} r={5} className={styles.junction} />
                )}
                {isGate && (
                  <text x={px} y={py - 18} className={styles.nodeLabel} textAnchor="middle">
                    GATE
                  </text>
                )}
              </g>
            );
          }

          const count = containerCountsByBlock[node.blockId!] ?? 0;
          const stackDir = node.y < 0.5 ? -1 : 1; // row 0 stacks upward, row 1 downward
          const stackY = py + stackDir * 26;
          return (
            <g key={node.id}>
              <line x1={px} y1={py} x2={px} y2={stackY} stroke={COLOR_LINE} strokeWidth={2} />
              <rect
                x={px - 22}
                y={stackDir === -1 ? stackY - STACK_HEIGHT : stackY}
                width={44}
                height={STACK_HEIGHT}
                rx={2}
                className={styles.blockStack}
                style={{ opacity: 0.35 + Math.min(count / 130, 1) * 0.55 }}
              />
              <text
                x={px}
                y={stackDir === -1 ? stackY - STACK_HEIGHT / 2 - 8 : stackY + STACK_HEIGHT / 2 - 4}
                textAnchor="middle"
                className={styles.blockLetter}
              >
                {node.blockId}
              </text>
              <text
                x={px}
                y={stackDir === -1 ? stackY - STACK_HEIGHT / 2 + 10 : stackY + STACK_HEIGHT / 2 + 14}
                textAnchor="middle"
                className={styles.blockCountLabel}
              >
                {count}
              </text>
              <circle cx={px} cy={py} r={4} className={styles.junction} />
            </g>
          );
        })}

        {equipment.map((eq) => {
          const placement = equipmentPosition(eq, nodeById, project, nowMs);
          if (!placement) return null;
          const { px, py, inTransit, etaSeconds } = placement;
          // Small deterministic offset per equipment id so multiple units at the same node don't fully overlap.
          const hash = [...eq.id].reduce((s, c) => s + c.charCodeAt(0), 0);
          const ox = ((hash % 7) - 3) * 4;
          const oy = ((Math.floor(hash / 7) % 7) - 3) * 4;
          return (
            <g
              key={eq.id}
              className={`${styles.equipmentMarker} ${inTransit ? styles.equipmentMarkerMoving : ""}`}
              style={{ transform: `translate(${px + ox}px, ${py + oy}px)` }}
            >
              {eq.type === "CRANE" ? (
                <g>
                  {/* Gantry crane silhouette: mast, jib, hoist line — reads distinctly from the truck box at a glance. */}
                  <line x1={0} y1={8} x2={0} y2={-9} stroke={equipmentColor(eq.status)} strokeWidth={2.2} strokeLinecap="round" />
                  <line x1={-6} y1={-9} x2={10} y2={-9} stroke={equipmentColor(eq.status)} strokeWidth={2.2} strokeLinecap="round" />
                  <line x1={10} y1={-9} x2={10} y2={-1} stroke={equipmentColor(eq.status)} strokeWidth={1.6} strokeLinecap="round" />
                  <line x1={-7} y1={8} x2={7} y2={8} stroke={equipmentColor(eq.status)} strokeWidth={2.2} strokeLinecap="round" />
                  <circle cx={10} cy={-1} r={1.8} fill={equipmentColor(eq.status)} stroke={COLOR_BG} strokeWidth={0.75} />
                </g>
              ) : (
                <g>
                  {/* Yard truck: cab + trailer bed + wheels. */}
                  <rect x={-10} y={-3} width={7} height={7} rx={1} fill={equipmentColor(eq.status)} stroke={COLOR_BG} strokeWidth={1} />
                  <rect x={-3} y={-6} width={12} height={10} rx={1} fill={equipmentColor(eq.status)} stroke={COLOR_BG} strokeWidth={1} />
                  <circle cx={-6} cy={6} r={2.2} fill={COLOR_BG} stroke={equipmentColor(eq.status)} strokeWidth={1.4} />
                  <circle cx={5} cy={6} r={2.2} fill={COLOR_BG} stroke={equipmentColor(eq.status)} strokeWidth={1.4} />
                </g>
              )}
              <title>
                {eq.id} · {eq.type} · {eq.status}
                {inTransit ? ` · en route to ${eq.movementTargetNodeId}, arriving in ${etaSeconds}s` : ""}
              </title>
            </g>
          );
        })}
      </svg>
      <div className={styles.legend}>
        <span>
          <i className={styles.legendDot} style={{ background: COLOR_GREEN }} /> Available
        </span>
        <span>
          <i className={styles.legendDot} style={{ background: COLOR_AMBER }} /> Busy
        </span>
        <span>
          <i className={styles.legendDot} style={{ background: COLOR_MUTED }} /> Offline
        </span>
        <span>
          <i className={styles.legendLine} style={{ background: COLOR_RED }} /> High congestion
        </span>
        <span>
          <i className={styles.legendBarrier} /> Blocked{onLaneToggle ? " (click a lane to toggle)" : ""}
        </span>
        {routePoints.length > 1 && (
          <span>
            <i className={styles.legendLine} style={{ background: COLOR_ACCENT }} /> Planned route
          </span>
        )}
      </div>
    </div>
  );
}

function RouteMarker({ points }: { points: { px: number; py: number }[] }) {
  const [t, setT] = useState(0);
  const frame = useRef<number>(0);

  useEffect(() => {
    const durationMs = 2400;
    const start = performance.now();
    const loop = (now: number) => {
      const elapsed = (now - start) % durationMs;
      setT(elapsed / durationMs);
      frame.current = requestAnimationFrame(loop);
    };
    frame.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame.current);
  }, [points.length]);

  if (points.length < 2) return null; // defensive: parent already gates this, but don't trust it blindly

  const segments = points.length - 1;
  const segFloat = t * segments;
  // Clamp to both ends: Math.min alone only protects the upper bound, and
  // t/points can transiently disagree across a render (e.g. React Strict
  // Mode's dev-only double-invoked effects) — an unguarded lower bound
  // produced a real -1 index and crashed the page during live testing.
  const segIndex = Math.max(0, Math.min(Math.floor(segFloat), segments - 1));
  const segT = segFloat - segIndex;
  const a = points[segIndex];
  const b = points[segIndex + 1] ?? a;
  const x = a.px + (b.px - a.px) * segT;
  const y = a.py + (b.py - a.py) * segT;

  return (
    <>
      <polyline
        points={points.map((p) => `${p.px},${p.py}`).join(" ")}
        fill="none"
        stroke={COLOR_ACCENT}
        strokeWidth={2}
        strokeDasharray="4 4"
        opacity={0.5}
      />
      <circle cx={x} cy={y} r={6} fill={COLOR_ACCENT} stroke={COLOR_BG} strokeWidth={1.5} />
    </>
  );
}
