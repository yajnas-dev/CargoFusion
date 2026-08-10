"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
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

interface YardSummary {
  blocks: { id: string; name: string }[];
  lanes: { id: string; blocked: boolean; congestionWeight: number }[];
  equipment: { id: string; type: "CRANE" | "YARD_TRUCK"; status: "AVAILABLE" | "BUSY" | "OFFLINE" }[];
  containerCountsByBlock: Record<string, number>;
  activeTaskCount: number;
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

  const refresh = useCallback(async () => {
    const [yardData, taskData, simStatus] = await Promise.all([
      api<YardSummary>("/api/yard"),
      api<{ tasks: TaskRow[] }>("/api/tasks"),
      api<{ running: boolean }>("/api/simulation/status"),
    ]);
    setYard(yardData);
    setTasks(taskData.tasks);
    setSimRunning(simStatus.running);
  }, []);

  useEffect(() => {
    const timeout = setTimeout(refresh, 0); // deferred so the initial load doesn't setState synchronously in the effect
    const interval = setInterval(refresh, 8000);
    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, [refresh]);

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

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>CargoFusion ACSA</h1>
        <p className={styles.subtitle}>Autonomous Container Search Assistant — prototype demo</p>
        <Link href="/worker" className={styles.workerLink}>
          Open Worker App →
        </Link>
      </header>

      <section className={styles.panel}>
        <h2>Yard Overview</h2>
        {!yard ? (
          <p>Loading…</p>
        ) : (
          <div className={styles.yardGrid}>
            <div className={styles.statCard}>
              <span className={styles.statLabel}>Active tasks</span>
              <span className={styles.statValue}>{yard.activeTaskCount}</span>
            </div>
            <div className={styles.statCard}>
              <span className={styles.statLabel}>Equipment available</span>
              <span className={styles.statValue}>
                {yard.equipment.filter((e) => e.status === "AVAILABLE").length} / {yard.equipment.length}
              </span>
            </div>
            <div className={styles.statCard}>
              <span className={styles.statLabel}>Blocked lanes</span>
              <span className={styles.statValue}>{yard.lanes.filter((l) => l.blocked).length}</span>
            </div>
            <div className={styles.statCard}>
              <span className={styles.statLabel}>Avg congestion</span>
              <span className={styles.statValue}>
                {(yard.lanes.reduce((s, l) => s + l.congestionWeight, 0) / yard.lanes.length).toFixed(2)}x
              </span>
            </div>
          </div>
        )}
        {yard && (
          <div className={styles.blockRow}>
            {yard.blocks.map((b) => (
              <div key={b.id} className={styles.blockTile}>
                <div className={styles.blockName}>{b.id}</div>
                <div className={styles.blockCount}>{yard.containerCountsByBlock[b.id] ?? 0}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className={styles.panel}>
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
      </section>

      <section className={styles.panel}>
        <h2>Retrieval Request</h2>
        <form onSubmit={submitRequest} className={styles.requestForm}>
          <input
            type="text"
            placeholder='e.g. "Retrieve MSKU1234567" or "Get container out as quickly as possible"'
            value={requestText}
            onChange={(e) => setRequestText(e.target.value)}
            className={styles.textInput}
          />
          <button type="submit" disabled={submitting} className={styles.primaryButton}>
            {submitting ? "Planning…" : "Submit"}
          </button>
        </form>
        {error && <p className={styles.errorText}>{error}</p>}
      </section>

      {result && (
        <section className={styles.panel}>
          <h2>Recommendation</h2>
          <p className={styles.explanation}>{result.explanation}</p>

          {result.planResult.container && (
            <div className={styles.recDetails}>
              <div>
                <strong>Container:</strong> {result.planResult.container.id} (block{" "}
                {result.planResult.container.block}, row {result.planResult.container.row}, bay{" "}
                {result.planResult.container.bay}, tier {result.planResult.container.tier}) →{" "}
                {result.planResult.container.destination}
              </div>
              {result.planResult.selectedEquipment && (
                <div>
                  <strong>Equipment:</strong> {result.planResult.selectedEquipment.equipment.id} (
                  {result.planResult.selectedEquipment.equipment.type}), score{" "}
                  {result.planResult.selectedEquipment.score.toFixed(2)}
                </div>
              )}
              {result.planResult.route && (
                <div>
                  <strong>Route:</strong> {result.planResult.route.path.join(" → ")} (
                  {result.planResult.route.distanceMeters.toFixed(0)}m, ETA{" "}
                  {Math.round(result.planResult.route.estimatedSeconds)}s)
                </div>
              )}
              {result.planResult.twin && (
                <div>
                  <strong>Digital twin:</strong> {result.planResult.twin.recommendedAction}
                  {result.planResult.twin.issues.length > 0 &&
                    ` — ${result.planResult.twin.issues.map((i) => i.message).join("; ")}`}
                </div>
              )}
              {result.confidence && (
                <div>
                  <strong>Confidence:</strong>{" "}
                  <span className={styles[`confidence${result.confidence.level}`]}>
                    {result.confidence.level}
                  </span>{" "}
                  ({(result.confidence.score * 100).toFixed(0)}%)
                  <ul className={styles.factorList}>
                    {result.confidence.factors.map((f) => (
                      <li key={f.name}>
                        {f.name}: {f.value.toFixed(2)} × {f.weight} = {f.contribution.toFixed(2)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {currentTask?.status === "PLANNED" && taskId && (
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
                    runAction(`/api/tasks/${taskId}/reject`, { actor: "supervisor", reason: "Rejected by supervisor" })
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

          {currentTask?.status === "APPROVED" && taskId && (
            <div className={styles.approvalPanel}>
              <button
                className={styles.primaryButton}
                onClick={() => runAction(`/api/tasks/${taskId}/dispatch`, { actor: "supervisor" })}
              >
                Dispatch to Worker
              </button>
            </div>
          )}

          {currentTask?.status === "RETRIEVED" && taskId && (
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
        </section>
      )}

      <section className={styles.panel}>
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
      </section>
    </div>
  );
}
