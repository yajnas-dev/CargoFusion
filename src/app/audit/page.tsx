"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import styles from "./page.module.css";

type AuditAction =
  | "REQUEST_SUBMITTED"
  | "RECOMMENDATION_GENERATED"
  | "APPROVED"
  | "REJECTED"
  | "OVERRIDDEN"
  | "DISPATCHED"
  | "WORKER_CONFIRMED"
  | "STATUS_CHANGED"
  | "AGENT_ALERT_RAISED"
  | "AGENT_ALERT_APPLIED"
  | "AGENT_ALERT_DISMISSED";

const ACTIONS: AuditAction[] = [
  "REQUEST_SUBMITTED",
  "RECOMMENDATION_GENERATED",
  "APPROVED",
  "REJECTED",
  "OVERRIDDEN",
  "DISPATCHED",
  "WORKER_CONFIRMED",
  "STATUS_CHANGED",
  "AGENT_ALERT_RAISED",
  "AGENT_ALERT_APPLIED",
  "AGENT_ALERT_DISMISSED",
];

interface AuditEventRow {
  id: string;
  taskId: string | null;
  agentAlertId: string | null;
  action: AuditAction;
  actor: string;
  detailsJson: string;
  createdAt: string;
  task: { container: { id: string } } | null;
  agentAlert: { type: string } | null;
}

async function api<T>(path: string): Promise<T> {
  const res = await fetch(path);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `Request to ${path} failed`);
  return data as T;
}

function formatDetails(json: string): string {
  try {
    const parsed = JSON.parse(json);
    if (parsed && typeof parsed === "object" && Object.keys(parsed).length === 0) return "—";
    return JSON.stringify(parsed);
  } catch {
    return json;
  }
}

export default function AuditPage() {
  const [events, setEvents] = useState<AuditEventRow[]>([]);
  const [taskId, setTaskId] = useState("");
  const [action, setAction] = useState<"" | AuditAction>("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async (currentTaskId: string, currentAction: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (currentTaskId) params.set("taskId", currentTaskId);
      if (currentAction) params.set("action", currentAction);
      const data = await api<{ events: AuditEventRow[] }>(`/api/audit?${params.toString()}`);
      setEvents(data.events);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Read ?taskId= directly rather than next/navigation's useSearchParams,
    // which forces a Suspense boundary on an otherwise plain client page.
    // Deferred so the initial load doesn't setState synchronously in the effect.
    const timeout = setTimeout(() => {
      const initialTaskId = new URLSearchParams(window.location.search).get("taskId") ?? "";
      setTaskId(initialTaskId);
      refresh(initialTaskId, "");
    }, 0);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyFilters(e: React.FormEvent) {
    e.preventDefault();
    refresh(taskId, action);
  }

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <div className={styles.topbarLeft}>
          <Link href="/" className={styles.backLink}>
            ← Dashboard
          </Link>
          <div className={styles.divider} />
          <h1>Audit Trail</h1>
          <span className={styles.countBadge}>{events.length} events</span>
        </div>
        <form className={styles.filterForm} onSubmit={applyFilters}>
          <input
            type="text"
            aria-label="Task ID filter"
            placeholder="Filter by task ID…"
            value={taskId}
            onChange={(e) => setTaskId(e.target.value)}
            className={styles.textInput}
          />
          <select
            aria-label="Action filter"
            value={action}
            onChange={(e) => setAction(e.target.value as "" | AuditAction)}
            className={styles.select}
          >
            <option value="">All actions</option>
            {ACTIONS.map((a) => (
              <option key={a} value={a}>
                {a.replace(/_/g, " ")}
              </option>
            ))}
          </select>
          <button type="submit" className={styles.applyButton} disabled={loading}>
            {loading ? "Loading…" : "Apply"}
          </button>
        </form>
      </header>

      {error && <div className={styles.errorBar}>{error}</div>}

      <div className={styles.body}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Time</th>
              <th>Action</th>
              <th>Actor</th>
              <th>Task / Container</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {events.map((ev) => (
              <tr key={ev.id}>
                <td className={styles.timeCell}>{new Date(ev.createdAt).toLocaleString()}</td>
                <td>
                  <span className={styles.actionBadge}>{ev.action.replace(/_/g, " ")}</span>
                </td>
                <td>{ev.actor}</td>
                <td>
                  {ev.task ? (
                    <Link href={`/audit?taskId=${ev.taskId}`} className={styles.taskLink}>
                      {ev.task.container.id}
                    </Link>
                  ) : ev.agentAlert ? (
                    `alert: ${ev.agentAlert.type.replace(/_/g, " ")}`
                  ) : (
                    "—"
                  )}
                </td>
                <td className={styles.detailsCell}>{formatDetails(ev.detailsJson)}</td>
              </tr>
            ))}
            {events.length === 0 && !loading && (
              <tr>
                <td colSpan={5}>No matching audit events.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
