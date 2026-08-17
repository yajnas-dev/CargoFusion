"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useLiveEvents } from "../useLiveEvents";
import { TOPICS } from "@/events/topics";
import styles from "./page.module.css";

type Priority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";
type TaskStatus = "REQUESTED" | "PLANNED";
type ConfidenceLevel = "HIGH" | "MEDIUM" | "LOW";

interface QueueTask {
  id: string;
  status: TaskStatus;
  priority: Priority;
  createdAt: string;
  dueBy: string | null;
  naturalLanguageRequest: string | null;
  container: { id: string; block: string; row: number; bay: number; tier: number };
  assignedEquipment: { id: string; type: string } | null;
  recommendations: { confidenceLevel: ConfidenceLevel; explanation: string }[];
}

interface EquipmentOption {
  id: string;
  type: string;
  status: string;
  activeTaskCount: number;
}

interface SessionUser {
  role: "OPERATOR" | "SUPERVISOR" | "WORKER";
}

interface AgentConfig {
  agingTaskThresholdMs: number;
}

const PRIORITY_RANK: Record<Priority, number> = { URGENT: 3, HIGH: 2, MEDIUM: 1, LOW: 0 };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `Request to ${path} failed`);
  return data as T;
}

function ageMinutes(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
}

function minutesUntil(iso: string): number {
  return Math.round((new Date(iso).getTime() - Date.now()) / 60000);
}

export default function ApprovalQueuePage() {
  const [tasks, setTasks] = useState<QueueTask[]>([]);
  const [equipment, setEquipment] = useState<EquipmentOption[]>([]);
  const [config, setConfig] = useState<AgentConfig | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [overrideOpenFor, setOverrideOpenFor] = useState<string | null>(null);
  const [overrideEquipmentId, setOverrideEquipmentId] = useState("");
  const [overrideReason, setOverrideReason] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [taskData, equipmentData, configData] = await Promise.all([
        api<{ tasks: QueueTask[] }>("/api/tasks?status=REQUESTED,PLANNED"),
        api<{ equipment: EquipmentOption[] }>("/api/equipment"),
        api<{ config: AgentConfig }>("/api/agent/config"),
      ]);
      setTasks(taskData.tasks);
      setEquipment(equipmentData.equipment);
      setConfig(configData.config);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    api<{ user: SessionUser }>("/api/auth/me")
      .then((d) => setUser(d.user))
      .catch(() => setUser(null));
  }, []);

  useEffect(() => {
    const timeout = setTimeout(refresh, 0);
    const interval = setInterval(refresh, 15000);
    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, [refresh]);

  useLiveEvents({
    [TOPICS.TASK_CHANGED]: () => refresh(),
    [TOPICS.RECOMMENDATION_CREATED]: () => refresh(),
  });

  const sorted = useMemo(
    () =>
      [...tasks].sort((a, b) => {
        const byPriority = PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority];
        if (byPriority !== 0) return byPriority;
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(); // oldest first within a priority
      }),
    [tasks],
  );

  const canAct = user?.role === "SUPERVISOR";
  const agingThresholdMin = config ? Math.round(config.agingTaskThresholdMs / 60000) : null;
  const highConfidencePlanned = sorted.filter(
    (t) => t.status === "PLANNED" && t.recommendations[0]?.confidenceLevel === "HIGH",
  );

  async function runAction(path: string, body: Record<string, unknown> = {}) {
    setError(null);
    setPending(path);
    try {
      await api(path, { method: "POST", body: JSON.stringify(body) });
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(null);
    }
  }

  async function approveAllHighConfidence() {
    setError(null);
    setPending("bulk-approve");
    try {
      for (const t of highConfidencePlanned) {
        await api(`/api/tasks/${t.id}/approve`, { method: "POST" });
      }
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(null);
    }
  }

  function submitOverride(taskId: string) {
    if (!overrideEquipmentId || !overrideReason) return;
    runAction(`/api/tasks/${taskId}/override`, { equipmentId: overrideEquipmentId, reason: overrideReason }).then(
      () => {
        setOverrideOpenFor(null);
        setOverrideEquipmentId("");
        setOverrideReason("");
      },
    );
  }

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <div className={styles.topbarLeft}>
          <Link href="/" className={styles.backLink}>
            ← Dashboard
          </Link>
          <div className={styles.divider} />
          <h1>Approval Queue</h1>
          <span className={styles.countBadge}>{sorted.length} pending</span>
        </div>
        <div className={styles.topbarRight}>
          {!canAct && user && <span className={styles.readOnlyNote}>Read-only — sign in as SUPERVISOR to act</span>}
          {highConfidencePlanned.length > 0 && canAct && (
            <button
              className={styles.bulkButton}
              disabled={pending === "bulk-approve"}
              onClick={approveAllHighConfidence}
            >
              Approve all high-confidence ({highConfidencePlanned.length})
            </button>
          )}
        </div>
      </header>

      {error && <div className={styles.errorBar}>{error}</div>}

      <div className={styles.body}>
        {sorted.length === 0 && (
          <p className={styles.emptyState}>Nothing waiting on a decision. New requests will appear here.</p>
        )}

        {sorted.map((task) => {
          const age = ageMinutes(task.createdAt);
          const isAging = agingThresholdMin !== null && age >= agingThresholdMin;
          const rec = task.recommendations[0];
          const dueByMinutes = task.dueBy ? minutesUntil(task.dueBy) : null;
          const dueBreached = dueByMinutes !== null && dueByMinutes <= 0;

          return (
            <div key={task.id} className={`${styles.card} ${isAging || dueBreached ? styles.cardAging : ""}`}>
              <div className={styles.cardHeader}>
                <div className={styles.cardHeaderLeft}>
                  <span className={styles.containerId}>{task.container.id}</span>
                  <span className={`${styles.priorityBadge} ${styles[`priority${task.priority}`]}`}>
                    {task.priority}
                  </span>
                  <span className={styles.statusTag}>{task.status}</span>
                  {isAging && <span className={styles.agingTag}>Aging · {age}m</span>}
                  {dueByMinutes !== null && (
                    <span className={styles.agingTag}>
                      {dueBreached ? `Overdue · ${Math.abs(dueByMinutes)}m` : `Due in ${dueByMinutes}m`}
                    </span>
                  )}
                </div>
                <span className={styles.ageText}>{age}m ago</span>
              </div>

              <div className={styles.cardMeta}>
                Block {task.container.block} · Row {task.container.row}, Bay {task.container.bay}, Tier{" "}
                {task.container.tier}
                {task.naturalLanguageRequest ? ` · "${task.naturalLanguageRequest}"` : ""}
              </div>

              {task.status === "PLANNED" && rec ? (
                <div className={styles.recRow}>
                  <span className={styles[`confidence${rec.confidenceLevel}`]}>{rec.confidenceLevel} confidence</span>
                  <span className={styles.equipmentTag}>{task.assignedEquipment?.id ?? "no equipment"}</span>
                </div>
              ) : (
                <p className={styles.noPlanNote}>No viable plan was found automatically — assign equipment manually.</p>
              )}

              {canAct && (
                <div className={styles.actions}>
                  {task.status === "PLANNED" && (
                    <button
                      className={styles.approveButton}
                      disabled={pending === `/api/tasks/${task.id}/approve`}
                      onClick={() => runAction(`/api/tasks/${task.id}/approve`)}
                    >
                      Approve
                    </button>
                  )}
                  <button
                    className={styles.rejectButton}
                    disabled={pending === `/api/tasks/${task.id}/reject`}
                    onClick={() => runAction(`/api/tasks/${task.id}/reject`, { reason: "Rejected from approval queue" })}
                  >
                    Reject
                  </button>
                  <button
                    className={styles.overrideButton}
                    onClick={() => setOverrideOpenFor(overrideOpenFor === task.id ? null : task.id)}
                  >
                    {task.status === "PLANNED" ? "Override" : "Assign equipment"}
                  </button>
                </div>
              )}

              {overrideOpenFor === task.id && (
                <div className={styles.overrideForm}>
                  <select
                    aria-label="Equipment"
                    className={styles.select}
                    value={overrideEquipmentId}
                    onChange={(e) => setOverrideEquipmentId(e.target.value)}
                  >
                    <option value="">Choose equipment…</option>
                    {equipment
                      .filter((e) => e.status === "AVAILABLE")
                      .map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.id} ({e.type}, {e.activeTaskCount} active)
                        </option>
                      ))}
                  </select>
                  <input
                    type="text"
                    aria-label="Reason"
                    placeholder="Reason"
                    className={styles.textInput}
                    value={overrideReason}
                    onChange={(e) => setOverrideReason(e.target.value)}
                  />
                  <button
                    className={styles.confirmOverrideButton}
                    disabled={!overrideEquipmentId || !overrideReason}
                    onClick={() => submitOverride(task.id)}
                  >
                    Confirm
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
