"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import YardMap, { type MapEquipment, type MapLane, type MapNode } from "../YardMap";
import styles from "./page.module.css";

interface YardSummary {
  nodes: MapNode[];
  lanes: MapLane[];
  equipment: MapEquipment[];
  containerCountsByBlock: Record<string, number>;
  activeTaskCount: number;
  totalContainers: number;
  containersInYard: number;
  craneUtilization: number;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `Request to ${path} failed`);
  return data as T;
}

export default function SimulationPage() {
  const [yard, setYard] = useState<YardSummary | null>(null);
  const [simRunning, setSimRunning] = useState(false);
  const [selectedLaneId, setSelectedLaneId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [clock, setClock] = useState("");
  const [pending, setPending] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [yardData, simStatus] = await Promise.all([
        api<YardSummary>("/api/yard"),
        api<{ running: boolean }>("/api/simulation/status"),
      ]);
      setYard(yardData);
      setSimRunning(simStatus.running);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    const timeout = setTimeout(refresh, 0);
    const interval = setInterval(refresh, 4000); // faster than the dashboard's poll — this page exists to watch the yard change live
    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, [refresh]);

  useEffect(() => {
    const update = () => setClock(new Date().toLocaleTimeString());
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, []);

  async function runAction(key: string, path: string, body: Record<string, unknown> = {}) {
    setError(null);
    setPending(key);
    try {
      await api(path, { method: "POST", body: JSON.stringify(body) });
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(null);
    }
  }

  function toggleLane(lane: MapLane) {
    const path = lane.blocked ? "/api/simulation/unblock-lane" : "/api/simulation/block-lane";
    return runAction(`lane:${lane.id}`, path, { laneId: lane.id });
  }

  const blockedCount = yard?.lanes.filter((l) => l.blocked).length ?? 0;
  const selectedLane = yard?.lanes.find((l) => l.id === selectedLaneId);
  const avgCongestion = yard && yard.lanes.length > 0 ? yard.lanes.reduce((s, l) => s + l.congestionWeight, 0) / yard.lanes.length : 0;
  const availableEquipment = yard?.equipment.filter((e) => e.status === "AVAILABLE").length ?? 0;

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <div className={styles.topbarLeft}>
          <Link href="/" className={styles.backLink}>
            ← Dashboard
          </Link>
          <div className={styles.divider} />
          <h1>Yard Simulation</h1>
          <span className={`${styles.liveBadge} ${simRunning ? styles.liveBadgeOn : ""}`}>
            <span className={styles.liveDot} />
            {simRunning ? "Live" : "Static"}
          </span>
        </div>
        <div className={styles.topbarRight}>
          {blockedCount > 0 && <span className={styles.blockedBadge}>{blockedCount} lane{blockedCount === 1 ? "" : "s"} blocked</span>}
          <span className={styles.clock}>{clock}</span>
          <Link href="/worker" className={styles.workerLink}>
            Worker App →
          </Link>
        </div>
      </header>

      {error && <div className={styles.errorBar}>{error}</div>}

      <div className={styles.body}>
        <div className={styles.mapArea}>
          {yard ? (
            <YardMap
              className={styles.mapFill}
              nodes={yard.nodes}
              lanes={yard.lanes}
              equipment={yard.equipment}
              containerCountsByBlock={yard.containerCountsByBlock}
              live={simRunning}
              onLaneToggle={toggleLane}
            />
          ) : (
            <p className={styles.loading}>Loading yard…</p>
          )}
        </div>

        <aside className={styles.controls}>
          <section className={styles.statGrid}>
            <MiniStat label="Containers in yard" value={yard ? `${yard.containersInYard}/${yard.totalContainers}` : "—"} />
            <MiniStat label="Active tasks" value={yard?.activeTaskCount ?? "—"} />
            <MiniStat label="Equipment available" value={yard ? `${availableEquipment}/${yard.equipment.length}` : "—"} />
            <MiniStat label="Crane utilization" value={yard ? `${(yard.craneUtilization * 100).toFixed(0)}%` : "—"} />
            <MiniStat label="Avg congestion" value={yard ? `${avgCongestion.toFixed(2)}x` : "—"} />
            <MiniStat label="Blocked lanes" value={blockedCount} accent={blockedCount > 0 ? "red" : undefined} />
          </section>

          <section className={styles.section}>
            <h2>Background Simulation</h2>
            <p className={styles.sectionHint}>
              Continuous ambient activity — equipment moves, congestion drifts, occasional RFID checkpoints and
              availability changes.
            </p>
            <button
              className={simRunning ? styles.stopButton : styles.startButton}
              disabled={pending === "toggle-sim"}
              onClick={() => runAction("toggle-sim", simRunning ? "/api/simulation/stop" : "/api/simulation/start")}
            >
              {simRunning ? "Stop Background Simulation" : "Start Background Simulation"}
            </button>
          </section>

          <section className={styles.section}>
            <h2>Block or Unblock a Lane</h2>
            <p className={styles.sectionHint}>Click any lane on the map, or pick one precisely here.</p>
            <div className={styles.laneRow}>
              <select
                aria-label="Lane to block or unblock"
                className={styles.select}
                value={selectedLaneId}
                onChange={(e) => setSelectedLaneId(e.target.value)}
              >
                <option value="">Choose a lane…</option>
                {yard?.lanes.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.fromNodeId} → {l.toNodeId} {l.blocked ? "(blocked)" : `(congestion ${l.congestionWeight.toFixed(2)})`}
                  </option>
                ))}
              </select>
              <button
                className={selectedLane?.blocked ? styles.startButton : styles.stopButton}
                disabled={!selectedLane || pending === `lane:${selectedLane?.id}`}
                onClick={() => selectedLane && toggleLane(selectedLane)}
              >
                {selectedLane?.blocked ? "Unblock" : "Block"}
              </button>
            </div>
            <button className={styles.actionButton} disabled={pending === "unblock-all"} onClick={() => runAction("unblock-all", "/api/simulation/unblock-lanes")}>
              Unblock All Lanes
            </button>
          </section>

          <section className={styles.section}>
            <h2>Quick Actions</h2>
            <div className={styles.actionGrid}>
              <button className={styles.actionButton} disabled={pending === "congestion"} onClick={() => runAction("congestion", "/api/simulation/congestion", {})}>
                Simulate Congestion Spike
              </button>
              <button className={styles.actionButton} disabled={pending === "block-random"} onClick={() => runAction("block-random", "/api/simulation/block-lane", {})}>
                Block Random Lane
              </button>
              <button className={styles.actionButton} disabled={pending === "move-equipment"} onClick={() => runAction("move-equipment", "/api/simulation/move-equipment", {})}>
                Move Random Equipment
              </button>
              <button className={styles.actionButton} disabled={pending === "rfid"} onClick={() => runAction("rfid", "/api/simulation/rfid-event", {})}>
                Trigger RFID Event
              </button>
              <button className={styles.actionButton} disabled={pending === "flap"} onClick={() => runAction("flap", "/api/simulation/equipment-status", {})}>
                Flap Equipment Availability
              </button>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

function MiniStat({ label, value, accent }: { label: string; value: string | number; accent?: "red" }) {
  return (
    <div className={styles.miniStat}>
      <span className={styles.miniStatLabel}>{label}</span>
      <span className={`${styles.miniStatValue} ${accent === "red" ? styles.miniStatValueRed : ""}`}>{value}</span>
    </div>
  );
}
