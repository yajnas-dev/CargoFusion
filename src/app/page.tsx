"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import YardMap, { type MapEquipment, type MapLane, type MapNode } from "./YardMap";
import styles from "./page.module.css";

type Priority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";
type TaskStatus =
  | "REQUESTED"
  | "PLANNED"
  | "APPROVED"
  | "REJECTED"
  | "DISPATCHED"
  | "IN_PROGRESS"
  | "RETRIEVED"
  | "COMPLETED";

const STATUS_STEPS: TaskStatus[] = [
  "REQUESTED",
  "PLANNED",
  "APPROVED",
  "DISPATCHED",
  "IN_PROGRESS",
  "RETRIEVED",
  "COMPLETED",
];

interface YardSummary {
  blocks: { id: string; name: string }[];
  nodes: MapNode[];
  lanes: MapLane[];
  equipment: MapEquipment[];
  containerCountsByBlock: Record<string, number>;
  activeTaskCount: number;
  totalContainers: number;
  containersInYard: number;
  craneUtilization: number;
}

interface EquipmentCandidate {
  equipment: { id: string; type: string; capacityKg: number };
  score: number;
  factors: {
    distanceMeters: number;
    distanceScore: number;
    capacityFitScore: number;
    workloadScore: number;
    activeTaskCount: number;
  };
}

interface PlanResult {
  status: string;
  container?: { id: string; block: string; row: number; bay: number; tier: number; destination: string };
  containerMatches: { container: { id: string }; confidence: number; matchType: string }[];
  equipmentCandidates?: EquipmentCandidate[];
  selectedEquipment?: EquipmentCandidate;
  route?: { path: string[]; distanceMeters: number; estimatedSeconds: number };
  twin?: { valid: boolean; recommendedAction: string; issues: { type: string; message: string }[] };
}

interface ConfidenceAssessment {
  score: number;
  level: "HIGH" | "MEDIUM" | "LOW";
  factors: { name: string; value: number; weight: number; contribution: number; description: string }[];
}

interface SubmitResponse {
  interpreted: { containerQuery: string; priority: Priority; isAmbiguous: boolean; clarifyingQuestion?: string };
  explanation: string;
  planResult: PlanResult;
  task?: { id: string; status: TaskStatus };
  confidence?: ConfidenceAssessment;
}

interface TaskRow {
  id: string;
  status: TaskStatus;
  priority: Priority;
  createdAt: string;
  container: { id: string; block: string };
  assignedEquipment?: { id: string; type: string } | null;
  assignedWorker?: { id: string; name: string } | null;
  recommendations: { confidenceLevel: string; explanation: string }[];
}

const REQUESTED_BY = "operator";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `Request to ${path} failed`);
  return data as T;
}

const DISABLED_NAV_ITEMS = ["Equipment", "Trucks", "Alerts", "Analytics", "Settings"];

export default function Dashboard() {
  const [yard, setYard] = useState<YardSummary | null>(null);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [requestText, setRequestText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SubmitResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [overrideEquipmentId, setOverrideEquipmentId] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [simRunning, setSimRunning] = useState(false);
  const [apiHealthy, setApiHealthy] = useState(true);
  const [clock, setClock] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [yardData, taskData, simStatus] = await Promise.all([
        api<YardSummary>("/api/yard"),
        api<{ tasks: TaskRow[] }>("/api/tasks"),
        api<{ running: boolean }>("/api/simulation/status"),
      ]);
      setYard(yardData);
      setTasks(taskData.tasks);
      setSimRunning(simStatus.running);
      setApiHealthy(true);
    } catch {
      setApiHealthy(false);
    }
  }, []);

  useEffect(() => {
    const timeout = setTimeout(refresh, 0); // deferred so the initial load doesn't setState synchronously in the effect
    const interval = setInterval(refresh, 8000);
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

  async function submitRequest(e: React.FormEvent) {
    e.preventDefault();
    if (!requestText.trim()) return;
    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const data = await api<SubmitResponse>("/api/retrieval-requests", {
        method: "POST",
        body: JSON.stringify({ request: requestText, requestedBy: REQUESTED_BY }),
      });
      setResult(data);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function runAction(path: string, body: Record<string, unknown> = {}) {
    setError(null);
    try {
      await api(path, { method: "POST", body: JSON.stringify(body) });
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const taskId = result?.task?.id;
  const currentTask = tasks.find((t) => t.id === taskId);
  const activeStatus = currentTask?.status ?? result?.task?.status;
  const alertCount = yard ? yard.lanes.filter((l) => l.blocked).length + (result?.planResult.twin?.issues.length ?? 0) : 0;

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <span className={styles.brandIcon}>⚓</span>
          <div>
            <div className={styles.brandName}>ACSA</div>
            <div className={styles.brandSub}>Autonomous Container Search Assistant</div>
          </div>
        </div>
        <nav className={styles.nav}>
          <a href="#top" className={`${styles.navItem} ${styles.navItemActive}`}>
            Dashboard
          </a>
          <a href="#search-card" className={styles.navItem}>
            Container Search
          </a>
          <a href="#yard-map-card" className={styles.navItem}>
            Yard Map
          </a>
          <a href="#operations-card" className={styles.navItem}>
            Operations
          </a>
          <a href="#simulation-panel" className={styles.navItem}>
            Simulation
          </a>
          {DISABLED_NAV_ITEMS.map((item) => (
            <span key={item} className={styles.navItemDisabled} title="Not built in this prototype yet">
              {item}
            </span>
          ))}
        </nav>
        <div className={styles.sidebarFooter}>
          <div className={styles.systemStatus}>
            <span className={`${styles.statusDot} ${apiHealthy ? styles.statusDotOn : styles.statusDotOff}`} />
            {apiHealthy ? "System Online" : "API Unreachable"}
          </div>
          <Link href="/worker" className={styles.workerLink}>
            Open Worker App →
          </Link>
        </div>
      </aside>

      <div className={styles.main} id="top">
        <header className={styles.topbar}>
          <div>
            <h1>Container Search Assistant</h1>
            <p className={styles.topbarSub}>CargoFusion Terminal — prototype demo</p>
          </div>
          <div className={styles.topbarRight}>
            <span className={styles.clock}>{clock}</span>
            <span className={styles.bell} title={`${alertCount} active alert(s)`}>
              🔔
              {alertCount > 0 && <span className={styles.badge}>{alertCount}</span>}
            </span>
            <span className={styles.operator}>Operator</span>
          </div>
        </header>

        <div className={styles.content}>
          {yard && (
            <div className={styles.statRow}>
              <StatCard label="Total containers" value={yard.totalContainers.toLocaleString()} />
              <StatCard label="Containers in yard" value={yard.containersInYard.toLocaleString()} />
              <StatCard label="Active tasks" value={yard.activeTaskCount} />
              <StatCard
                label="Equipment available"
                value={`${yard.equipment.filter((e) => e.status === "AVAILABLE").length} / ${yard.equipment.length}`}
              />
              <StatCard label="Crane utilization" value={`${(yard.craneUtilization * 100).toFixed(0)}%`} />
              <StatCard
                label="Avg congestion"
                value={`${(yard.lanes.reduce((s, l) => s + l.congestionWeight, 0) / (yard.lanes.length || 1)).toFixed(2)}x`}
              />
            </div>
          )}

          {error && <p className={styles.errorText}>{error}</p>}

          <div className={styles.grid3}>
            <div className={styles.col} id="search-card">
              <div className={styles.panel}>
                <h2>Retrieval Request</h2>
                <form onSubmit={submitRequest} className={styles.requestForm}>
                  <input
                    type="text"
                    placeholder='e.g. "MSKU1234567" or "Get it out as quickly as possible"'
                    value={requestText}
                    onChange={(e) => setRequestText(e.target.value)}
                    className={styles.textInput}
                  />
                  <button type="submit" disabled={submitting} className={styles.primaryButton}>
                    {submitting ? "Planning…" : "Search"}
                  </button>
                </form>
              </div>

              {result?.planResult.container && (
                <div className={styles.panel}>
                  <h2>Container Details</h2>
                  <div className={styles.containerCard}>
                    <div className={styles.containerId}>{result.planResult.container.id}</div>
                    <dl className={styles.detailList}>
                      <div>
                        <dt>Yard Block</dt>
                        <dd>{result.planResult.container.block}</dd>
                      </div>
                      <div>
                        <dt>Row</dt>
                        <dd>{result.planResult.container.row}</dd>
                      </div>
                      <div>
                        <dt>Bay</dt>
                        <dd>{result.planResult.container.bay}</dd>
                      </div>
                      <div>
                        <dt>Tier</dt>
                        <dd>{result.planResult.container.tier}</dd>
                      </div>
                      <div>
                        <dt>Destination</dt>
                        <dd>{result.planResult.container.destination}</dd>
                      </div>
                    </dl>
                  </div>

                  {activeStatus && activeStatus !== "REJECTED" && (
                    <StatusStepper current={activeStatus} />
                  )}
                  {activeStatus === "REJECTED" && <div className={styles.rejectedBanner}>Request rejected</div>}
                </div>
              )}
            </div>

            <div className={styles.col} id="yard-map-card">
              <div className={styles.panel}>
                <h2>Yard Map (Live)</h2>
                {yard ? (
                  <YardMap
                    nodes={yard.nodes}
                    lanes={yard.lanes}
                    equipment={yard.equipment}
                    containerCountsByBlock={yard.containerCountsByBlock}
                    highlightPath={result?.planResult.route?.path}
                    live={simRunning}
                  />
                ) : (
                  <p>Loading…</p>
                )}
              </div>
            </div>

            <div className={styles.col} id="operations-card">
              {result && (
                <div className={styles.panel}>
                  <h2>AI Recommendations</h2>
                  <p className={styles.explanation}>{result.explanation}</p>

                  {result.planResult.selectedEquipment && (
                    <RecCard
                      icon={result.planResult.selectedEquipment.equipment.type === "CRANE" ? "🏗️" : "🚚"}
                      label={`Best ${result.planResult.selectedEquipment.equipment.type === "CRANE" ? "Crane" : "Truck"}`}
                      value={result.planResult.selectedEquipment.equipment.id}
                      sub={`Score ${result.planResult.selectedEquipment.score.toFixed(2)}`}
                    />
                  )}
                  {result.planResult.route && (
                    <RecCard
                      icon="⏱️"
                      label="Estimated Retrieval Time"
                      value={`${Math.round(result.planResult.route.estimatedSeconds)}s`}
                      sub={`${result.planResult.route.distanceMeters.toFixed(0)}m · ${result.planResult.route.path.join(" → ")}`}
                    />
                  )}
                  {result.planResult.twin && (
                    <RecCard
                      icon={result.planResult.twin.recommendedAction === "PROCEED" ? "✅" : "⚠️"}
                      label="Digital Twin"
                      value={result.planResult.twin.recommendedAction}
                      sub={result.planResult.twin.issues.map((i) => i.message).join("; ") || "No conflicts found"}
                    />
                  )}
                  {result.confidence && (
                    <div className={styles.confidenceCard}>
                      <div className={styles.confidenceHeader}>
                        <span>Confidence</span>
                        <span className={styles[`confidence${result.confidence.level}`]}>
                          {result.confidence.level} · {(result.confidence.score * 100).toFixed(0)}%
                        </span>
                      </div>
                      <ul className={styles.factorList}>
                        {result.confidence.factors.map((f) => (
                          <li key={f.name}>
                            {f.name}: {f.value.toFixed(2)} × {f.weight} = {f.contribution.toFixed(2)}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {activeStatus === "PLANNED" && taskId && (
                    <div className={styles.approvalPanel}>
                      <h3>Supervisor Decision</h3>
                      <div className={styles.buttonRow}>
                        <button
                          className={styles.approveButton}
                          onClick={() => runAction(`/api/tasks/${taskId}/approve`, { actor: "supervisor" })}
                        >
                          Approve
                        </button>
                        <button
                          className={styles.rejectButton}
                          onClick={() =>
                            runAction(`/api/tasks/${taskId}/reject`, {
                              actor: "supervisor",
                              reason: "Rejected by supervisor",
                            })
                          }
                        >
                          Reject
                        </button>
                      </div>
                      {result.planResult.equipmentCandidates && result.planResult.equipmentCandidates.length > 1 && (
                        <div className={styles.overrideForm}>
                          <select
                            value={overrideEquipmentId}
                            onChange={(e) => setOverrideEquipmentId(e.target.value)}
                            className={styles.select}
                          >
                            <option value="">Choose alternate equipment…</option>
                            {result.planResult.equipmentCandidates
                              .filter((c) => c.equipment.id !== result.planResult.selectedEquipment?.equipment.id)
                              .map((c) => (
                                <option key={c.equipment.id} value={c.equipment.id}>
                                  {c.equipment.id} (score {c.score.toFixed(2)})
                                </option>
                              ))}
                          </select>
                          <input
                            type="text"
                            placeholder="Reason for override"
                            value={overrideReason}
                            onChange={(e) => setOverrideReason(e.target.value)}
                            className={styles.textInput}
                          />
                          <button
                            className={styles.overrideButton}
                            disabled={!overrideEquipmentId || !overrideReason}
                            onClick={() =>
                              runAction(`/api/tasks/${taskId}/override`, {
                                actor: "supervisor",
                                reason: overrideReason,
                                equipmentId: overrideEquipmentId,
                              })
                            }
                          >
                            Override
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {activeStatus === "APPROVED" && taskId && (
                    <div className={styles.approvalPanel}>
                      <button
                        className={styles.primaryButton}
                        onClick={() => runAction(`/api/tasks/${taskId}/dispatch`, { actor: "supervisor" })}
                      >
                        Dispatch to Worker
                      </button>
                    </div>
                  )}

                  {activeStatus === "RETRIEVED" && taskId && (
                    <div className={styles.approvalPanel}>
                      <p className={styles.simDescription}>
                        The worker has confirmed retrieval. Close out the task to mark it complete.
                      </p>
                      <button
                        className={styles.approveButton}
                        onClick={() => runAction(`/api/tasks/${taskId}/complete`, { actor: "supervisor" })}
                      >
                        Mark Completed
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className={styles.panel} id="simulation-panel">
            <h2>Simulation Controls</h2>
            <p className={styles.simDescription}>
              Trigger yard events on demand, or start the background simulator for continuous ambient activity
              (equipment moves, congestion drifts, occasional RFID checkpoints and availability changes).
            </p>
            <div className={styles.simButtonRow}>
              <button
                className={simRunning ? styles.rejectButton : styles.approveButton}
                onClick={() => runAction(simRunning ? "/api/simulation/stop" : "/api/simulation/start")}
              >
                {simRunning ? "Stop Background Simulation" : "Start Background Simulation"}
              </button>
              <button className={styles.simButton} onClick={() => runAction("/api/simulation/congestion", {})}>
                Simulate Congestion Spike
              </button>
              <button className={styles.simButton} onClick={() => runAction("/api/simulation/block-lane", {})}>
                Block Random Lane
              </button>
              <button className={styles.simButton} onClick={() => runAction("/api/simulation/unblock-lanes")}>
                Unblock All Lanes
              </button>
              <button className={styles.simButton} onClick={() => runAction("/api/simulation/move-equipment", {})}>
                Move Random Equipment
              </button>
              <button className={styles.simButton} onClick={() => runAction("/api/simulation/rfid-event", {})}>
                Trigger RFID Event
              </button>
              <button className={styles.simButton} onClick={() => runAction("/api/simulation/equipment-status", {})}>
                Flap Equipment Availability
              </button>
            </div>
          </div>

          <div className={styles.panel}>
            <h2>Task Tracking</h2>
            <table className={styles.taskTable}>
              <thead>
                <tr>
                  <th>Container</th>
                  <th>Status</th>
                  <th>Priority</th>
                  <th>Equipment</th>
                  <th>Worker</th>
                  <th>Confidence</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((t) => (
                  <tr key={t.id}>
                    <td>
                      {t.container.id} ({t.container.block})
                    </td>
                    <td>
                      <span className={styles.statusBadge}>{t.status}</span>
                    </td>
                    <td>{t.priority}</td>
                    <td>{t.assignedEquipment?.id ?? "—"}</td>
                    <td>{t.assignedWorker?.name ?? "—"}</td>
                    <td>{t.recommendations[0]?.confidenceLevel ?? "—"}</td>
                    <td>
                      {t.status === "RETRIEVED" && (
                        <button
                          className={styles.simButton}
                          onClick={() => runAction(`/api/tasks/${t.id}/complete`, { actor: "supervisor" })}
                        >
                          Mark Completed
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {tasks.length === 0 && (
                  <tr>
                    <td colSpan={7}>No tasks yet — submit a retrieval request above.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className={styles.statCard}>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue}>{value}</span>
    </div>
  );
}

function RecCard({ icon, label, value, sub }: { icon: string; label: string; value: string; sub: string }) {
  return (
    <div className={styles.recCard}>
      <span className={styles.recIcon}>{icon}</span>
      <div className={styles.recBody}>
        <div className={styles.recLabel}>{label}</div>
        <div className={styles.recValue}>{value}</div>
        <div className={styles.recSub}>{sub}</div>
      </div>
    </div>
  );
}

function StatusStepper({ current }: { current: TaskStatus }) {
  const currentIndex = STATUS_STEPS.indexOf(current);
  return (
    <div className={styles.stepper}>
      {STATUS_STEPS.map((step, i) => (
        <div key={step} className={styles.stepperItem}>
          <span
            className={`${styles.stepperDot} ${i < currentIndex ? styles.stepperDotDone : ""} ${
              i === currentIndex ? styles.stepperDotCurrent : ""
            }`}
          />
          <span className={styles.stepperLabel}>{step.replace("_", " ")}</span>
          {i < STATUS_STEPS.length - 1 && (
            <span className={`${styles.stepperLine} ${i < currentIndex ? styles.stepperLineDone : ""}`} />
          )}
        </div>
      ))}
    </div>
  );
}
