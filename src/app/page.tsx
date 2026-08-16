"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MapEquipment, MapLane, MapNode } from "./YardMap";
import { useLiveEvents } from "./useLiveEvents";
import { TOPICS } from "@/events/topics";
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

interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: "OPERATOR" | "SUPERVISOR" | "WORKER";
  workerId?: string;
}

interface AgentAlertSummary {
  status: "OPEN" | "ACKNOWLEDGED" | "APPLIED" | "DISMISSED";
  severity: Priority;
  type: string;
}

interface WorkerSummary {
  status: "AVAILABLE" | "BUSY" | "OFF_SHIFT";
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

const DISABLED_NAV_ITEMS = ["Alerts", "Analytics", "Settings"];

const NAV_LINKS: { label: string; targetId: string }[] = [
  { label: "Dashboard", targetId: "top" },
  { label: "Container Search", targetId: "search-card" },
  { label: "Operations", targetId: "operations-card" },
];

export default function Dashboard() {
  const router = useRouter();
  const [yard, setYard] = useState<YardSummary | null>(null);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [workers, setWorkers] = useState<WorkerSummary[]>([]);
  const [agentAlerts, setAgentAlerts] = useState<AgentAlertSummary[]>([]);
  const [requestText, setRequestText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SubmitResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [overrideEquipmentId, setOverrideEquipmentId] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [simRunning, setSimRunning] = useState(false);
  const [agentRunning, setAgentRunning] = useState(false);
  const [openAgentAlertCount, setOpenAgentAlertCount] = useState(0);
  const [apiHealthy, setApiHealthy] = useState(true);
  const [clock, setClock] = useState("");
  const [activeNavId, setActiveNavId] = useState("top");
  const [toast, setToast] = useState<string | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);

  useEffect(() => {
    api<{ user: SessionUser }>("/api/auth/me")
      .then((data) => setUser(data.user))
      .catch(() => setUser(null));
  }, []);

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const refresh = useCallback(async () => {
    try {
      const [yardData, taskData, simStatus, agentStatus, alertData, workerData] = await Promise.all([
        api<YardSummary>("/api/yard"),
        api<{ tasks: TaskRow[] }>("/api/tasks"),
        api<{ running: boolean }>("/api/simulation/status"),
        api<{ running: boolean }>("/api/agent/status"),
        api<{ alerts: AgentAlertSummary[] }>("/api/agent/alerts"),
        api<{ workers: WorkerSummary[] }>("/api/workers"),
      ]);
      setYard(yardData);
      setTasks(taskData.tasks);
      setSimRunning(simStatus.running);
      setAgentRunning(agentStatus.running);
      setAgentAlerts(alertData.alerts);
      setOpenAgentAlertCount(
        alertData.alerts.filter((a) => a.status === "OPEN" || a.status === "ACKNOWLEDGED").length,
      );
      setWorkers(workerData.workers);
      setApiHealthy(true);
    } catch {
      setApiHealthy(false);
    }
  }, []);

  useEffect(() => {
    const timeout = setTimeout(refresh, 0); // deferred so the initial load doesn't setState synchronously in the effect
    // 30s fallback poll in case the SSE stream (below) is silently disconnected.
    const interval = setInterval(refresh, 30000);
    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, [refresh]);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debouncedRefresh = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(refresh, 300);
  }, [refresh]);

  useLiveEvents({
    [TOPICS.TASK_CHANGED]: debouncedRefresh,
    [TOPICS.RECOMMENDATION_CREATED]: debouncedRefresh,
    [TOPICS.YARD_LANE_CHANGED]: debouncedRefresh,
    [TOPICS.YARD_EQUIPMENT_CHANGED]: debouncedRefresh,
    [TOPICS.AGENT_ALERT_RAISED]: debouncedRefresh,
    [TOPICS.AGENT_ALERT_RESOLVED]: debouncedRefresh,
  });

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
        body: JSON.stringify({ request: requestText }),
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

  function goToSection(e: React.MouseEvent<HTMLAnchorElement>, targetId: string) {
    e.preventDefault();
    setActiveNavId(targetId);
    document.getElementById(targetId)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function showComingSoon(item: string) {
    setToast(`${item} isn't built in this prototype yet.`);
    setTimeout(() => setToast(null), 2500);
  }

  const taskId = result?.task?.id;
  const currentTask = tasks.find((t) => t.id === taskId);
  const activeStatus = currentTask?.status ?? result?.task?.status;
  const blockedLaneCount = yard ? yard.lanes.filter((l) => l.blocked).length : 0;
  const alertCount = blockedLaneCount + openAgentAlertCount + (result?.planResult.twin?.issues.length ?? 0);

  // Shift-Start Overview: everything that needs a decision right now, derived
  // from data already being polled — no extra endpoints.
  const pendingApprovalCount = tasks.filter((t) => t.status === "REQUESTED" || t.status === "PLANNED").length;
  const openAlerts = agentAlerts.filter((a) => a.status === "OPEN" || a.status === "ACKNOWLEDGED");
  const agingTaskAlertCount = openAlerts.filter(
    (a) => a.type === "AGING_TASK" || a.type === "URGENT_CONTAINER_UNACTIONED",
  ).length;
  const openBySeverity = (severity: Priority) => openAlerts.filter((a) => a.severity === severity).length;
  const equipmentAvailableCount = yard ? yard.equipment.filter((e) => e.status === "AVAILABLE").length : 0;
  const workersAvailableCount = workers.filter((w) => w.status === "AVAILABLE").length;

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
          {NAV_LINKS.map((link) => (
            <a
              key={link.targetId}
              href={`#${link.targetId}`}
              onClick={(e) => goToSection(e, link.targetId)}
              className={`${styles.navItem} ${activeNavId === link.targetId ? styles.navItemActive : ""}`}
            >
              {link.label}
            </a>
          ))}
          <Link href="/tasks" className={styles.navItem}>
            Approval Queue
            {pendingApprovalCount > 0 && <span className={styles.navCountDot}>{pendingApprovalCount}</span>}
          </Link>
          <Link href="/equipment" className={styles.navItem}>
            Equipment
          </Link>
          <Link href="/workers" className={styles.navItem}>
            Workers
          </Link>
          <Link href="/audit" className={styles.navItem}>
            Audit Trail
          </Link>
          <Link href="/simulation" className={styles.navItem}>
            Simulation
            {simRunning && <span className={styles.navLiveDot} />}
          </Link>
          <Link href="/agent" className={styles.navItem}>
            Agent
            {agentRunning && <span className={styles.navLiveDot} />}
          </Link>
          {DISABLED_NAV_ITEMS.map((item) => (
            <button
              key={item}
              type="button"
              className={styles.navItemDisabled}
              title="Not built in this prototype yet"
              onClick={() => showComingSoon(item)}
            >
              {item}
            </button>
          ))}
        </nav>
        {toast && <div className={styles.toast}>{toast}</div>}
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
            <span className={styles.operator}>{user ? `${user.name} (${user.role})` : "…"}</span>
            <button type="button" className={styles.signOutButton} onClick={logout}>
              Sign out
            </button>
          </div>
        </header>

        <div className={styles.content}>
          <div className={styles.overviewGrid}>
            <Link href="/tasks" className={`${styles.overviewCard} ${pendingApprovalCount > 0 ? styles.overviewCardAlert : ""}`}>
              <span className={styles.overviewValue}>{pendingApprovalCount}</span>
              <span className={styles.overviewLabel}>Pending approvals</span>
            </Link>
            <Link href="/agent" className={`${styles.overviewCard} ${agingTaskAlertCount > 0 ? styles.overviewCardWarn : ""}`}>
              <span className={styles.overviewValue}>{agingTaskAlertCount}</span>
              <span className={styles.overviewLabel}>Aging / unactioned</span>
            </Link>
            <Link href="/agent" className={`${styles.overviewCard} ${openBySeverity("URGENT") > 0 ? styles.overviewCardAlert : ""}`}>
              <span className={styles.overviewValue}>
                {openBySeverity("URGENT")} / {openBySeverity("HIGH")}
              </span>
              <span className={styles.overviewLabel}>Open alerts (urgent / high)</span>
            </Link>
            <Link href="/simulation" className={`${styles.overviewCard} ${blockedLaneCount > 0 ? styles.overviewCardWarn : ""}`}>
              <span className={styles.overviewValue}>{blockedLaneCount}</span>
              <span className={styles.overviewLabel}>Blocked lanes</span>
            </Link>
            <Link href="/equipment" className={styles.overviewCard}>
              <span className={styles.overviewValue}>
                {equipmentAvailableCount} / {yard?.equipment.length ?? 0}
              </span>
              <span className={styles.overviewLabel}>Equipment available</span>
            </Link>
            <Link href="/workers" className={styles.overviewCard}>
              <span className={styles.overviewValue}>
                {workersAvailableCount} / {workers.length}
              </span>
              <span className={styles.overviewLabel}>Workers available</span>
            </Link>
          </div>

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

          <Link href="/simulation" className={styles.simCta}>
            <div className={styles.simCtaLeft}>
              <span className={styles.simCtaIcon}>🗺️</span>
              <div>
                <h2>Yard Simulation</h2>
                <p>
                  {simRunning ? "Live background simulation running" : "Static — start the simulator for live drift"}
                  {yard ? ` · ${blockedLaneCount} lane${blockedLaneCount === 1 ? "" : "s"} blocked` : ""}
                </p>
              </div>
            </div>
            <span className={styles.simCtaArrow}>Open Full Simulation →</span>
          </Link>

          <Link href="/agent" className={styles.simCta}>
            <div className={styles.simCtaLeft}>
              <span className={styles.simCtaIcon}>🤖</span>
              <div>
                <h2>Container Management Agent</h2>
                <p>
                  {agentRunning ? "Watching yard/task state" : "Stopped — start it to watch for issues"}
                  {` · ${openAgentAlertCount} open alert${openAgentAlertCount === 1 ? "" : "s"}`}
                </p>
              </div>
            </div>
            <span className={styles.simCtaArrow}>Open Agent →</span>
          </Link>

          <div className={styles.grid2}>
            <div className={styles.col} id="search-card">
              <div className={styles.panel}>
                <h2>Retrieval Request</h2>
                <form onSubmit={submitRequest} className={styles.requestForm}>
                  <input
                    type="text"
                    aria-label="Retrieval request"
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
                          onClick={() => runAction(`/api/tasks/${taskId}/approve`, {})}
                        >
                          Approve
                        </button>
                        <button
                          className={styles.rejectButton}
                          onClick={() =>
                            runAction(`/api/tasks/${taskId}/reject`, {
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
                            aria-label="Alternate equipment"
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
                            aria-label="Reason for override"
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
                        onClick={() => runAction(`/api/tasks/${taskId}/dispatch`, {})}
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
                        onClick={() => runAction(`/api/tasks/${taskId}/complete`, {})}
                      >
                        Mark Completed
                      </button>
                    </div>
                  )}
                </div>
              )}
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
                          onClick={() => runAction(`/api/tasks/${t.id}/complete`, {})}
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
