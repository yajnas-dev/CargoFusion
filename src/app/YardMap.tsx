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
}

interface Props {
  nodes: MapNode[];
  lanes: MapLane[];
  equipment: MapEquipment[];
  containerCountsByBlock: Record<string, number>;
  /** Node ids, origin -> destination, for the most recently computed route. */
  highlightPath?: string[];
  live: boolean;
}

const SCALE_X = 130;
const SCALE_Y = 190;
const PAD = 70;
const STACK_HEIGHT = 46;

function congestionColor(weight: number, blocked: boolean): string {
  if (blocked) return "#e5484d";
  if (weight >= 2.2) return "#e5484d";
  if (weight >= 1.5) return "#f5a623";
  return "#2f855a";
}

function equipmentColor(status: MapEquipment["status"]): string {
  if (status === "AVAILABLE") return "#3fb950";
  if (status === "BUSY") return "#f5a623";
  return "#6e7681";
}

/**
 * 2D top-down rendering of the actual yard graph (real node coordinates
 * and lane topology from Phase 6's A* engine) — not a decorative
 * isometric mockup. Equipment markers transition smoothly between polls
 * when their currentNodeId changes (real state, animated); the route
 * marker along a highlighted path is a looping visual affordance for
 * "this is the planned route," not a live GPS feed.
 */
export default function YardMap({ nodes, lanes, equipment, containerCountsByBlock, highlightPath, live }: Props) {
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
      ? highlightPath.map((id) => project(nodeById.get(id)!)).filter(Boolean)
      : [];

  return (
    <div className={styles.wrap}>
      <div className={styles.liveRow}>
        <span className={`${styles.liveDot} ${live ? styles.liveDotOn : ""}`} />
        <span>{live ? "Live simulation running" : "Static (start simulation for live drift)"}</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className={styles.svg} role="img" aria-label="Yard map">
        {lanes.map((lane) => {
          const from = nodeById.get(lane.fromNodeId);
          const to = nodeById.get(lane.toNodeId);
          if (!from || !to) return null;
          const a = project(from);
          const b = project(to);
          const highlighted = highlightSet.has(`${lane.fromNodeId}|${lane.toNodeId}`);
          return (
            <line
              key={lane.id}
              x1={a.px}
              y1={a.py}
              x2={b.px}
              y2={b.py}
              stroke={highlighted ? "#5b8def" : congestionColor(lane.congestionWeight, lane.blocked)}
              strokeWidth={highlighted ? 5 : lane.blocked ? 3 : 2}
              strokeDasharray={lane.blocked ? "6 4" : undefined}
              className={styles.lane}
            />
          );
        })}

        {routePoints.length > 1 && (
          <RouteMarker points={routePoints} />
        )}

        {nodes.map((node) => {
          const { px, py } = project(node);
          const isBlockEntry = node.blockId !== null;
          if (!isBlockEntry) {
            return (
              <g key={node.id}>
                <circle cx={px} cy={py} r={5} className={styles.junction} />
                {node.id === "GATE" && (
                  <text x={px} y={py - 12} className={styles.nodeLabel} textAnchor="middle">
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
              <line x1={px} y1={py} x2={px} y2={stackY} stroke="#3a3f4b" strokeWidth={2} />
              <rect
                x={px - 22}
                y={stackDir === -1 ? stackY - STACK_HEIGHT : stackY}
                width={44}
                height={STACK_HEIGHT}
                rx={6}
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
          const node = nodeById.get(eq.currentNodeId);
          if (!node) return null;
          const { px, py } = project(node);
          // Small deterministic offset per equipment id so multiple units at the same node don't fully overlap.
          const hash = [...eq.id].reduce((s, c) => s + c.charCodeAt(0), 0);
          const ox = ((hash % 7) - 3) * 4;
          const oy = ((Math.floor(hash / 7) % 7) - 3) * 4;
          return (
            <g key={eq.id} className={styles.equipmentMarker} style={{ transform: `translate(${px + ox}px, ${py + oy}px)` }}>
              {eq.type === "CRANE" ? (
                <path d="M -6 6 L 0 -8 L 6 6 Z" fill={equipmentColor(eq.status)} stroke="#0d1117" strokeWidth={1} />
              ) : (
                <rect x={-6} y={-4} width={12} height={8} rx={2} fill={equipmentColor(eq.status)} stroke="#0d1117" strokeWidth={1} />
              )}
              <title>
                {eq.id} · {eq.type} · {eq.status}
              </title>
            </g>
          );
        })}
      </svg>
      <div className={styles.legend}>
        <span>
          <i className={styles.legendDot} style={{ background: "#3fb950" }} /> Available
        </span>
        <span>
          <i className={styles.legendDot} style={{ background: "#f5a623" }} /> Busy
        </span>
        <span>
          <i className={styles.legendDot} style={{ background: "#6e7681" }} /> Offline
        </span>
        <span>
          <i className={styles.legendLine} style={{ background: "#e5484d" }} /> Blocked / congested
        </span>
        {routePoints.length > 1 && (
          <span>
            <i className={styles.legendLine} style={{ background: "#5b8def" }} /> Planned route
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
        stroke="#5b8def"
        strokeWidth={2}
        strokeDasharray="4 4"
        opacity={0.5}
      />
      <circle cx={x} cy={y} r={6} fill="#5b8def" stroke="#0d1117" strokeWidth={1.5} />
    </>
  );
}
