"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useLiveEvents } from "../useLiveEvents";
import { TOPICS } from "@/events/topics";
import styles from "./page.module.css";

interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: "OPERATOR" | "SUPERVISOR" | "WORKER";
  workerId?: string;
}

interface ActiveTask {
  id: string;
  status: "DISPATCHED" | "IN_PROGRESS";
  container: { id: string; block: string; row: number; bay: number; tier: number };
  assignedEquipment?: { id: string; type: string } | null;
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

export default function WorkerApp() {
  const [session, setSession] = useState<SessionUser | null | undefined>(undefined);
  const [task, setTask] = useState<ActiveTask | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ user: SessionUser }>("/api/auth/me")
      .then((data) => setSession(data.user))
      .catch(() => setSession(null));
  }, []);

  const workerId = session?.workerId;

  const loadActiveTask = useCallback(async (id: string) => {
    const data = await api<{ task: ActiveTask | null }>(`/api/workers/${id}/active-task`);
    setTask(data.task);
  }, []);

  useEffect(() => {
    if (!workerId) return;
    const timeout = setTimeout(() => loadActiveTask(workerId), 0);
    // 15s fallback poll in case the SSE stream (below) is silently disconnected.
    const interval = setInterval(() => loadActiveTask(workerId), 15000);
    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, [workerId, loadActiveTask]);

  // The TASK_CHANGED payload doesn't carry which worker a task belongs to,
  // so any task change just re-fetches this worker's own active task —
  // the endpoint itself is already scoped server-side, so this is
  // correctness-safe, just occasionally a no-op refetch for other workers.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debouncedReload = useCallback(() => {
    if (!workerId) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => loadActiveTask(workerId), 300);
  }, [workerId, loadActiveTask]);

  useLiveEvents({ [TOPICS.TASK_CHANGED]: debouncedReload });

  async function startTask() {
    if (!task) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/tasks/${task.id}/start`, { method: "POST" });
      await loadActiveTask(workerId!);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmRetrieval() {
    if (!task) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/tasks/${task.id}/confirm`, { method: "POST" });
      await loadActiveTask(workerId!);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>Worker App</h1>
        <Link href="/" className={styles.backLink}>
          ← Back to dashboard
        </Link>
      </header>

      {session === undefined && <p className={styles.empty}>Loading…</p>}

      {session === null && <p className={styles.errorText}>Not signed in.</p>}

      {session && session.role !== "WORKER" && (
        <p className={styles.errorText}>
          Signed in as {session.name} ({session.role}) — this account isn&apos;t linked to a worker profile.
        </p>
      )}

      {session && session.role === "WORKER" && !session.workerId && (
        <p className={styles.errorText}>This worker account has no linked worker profile.</p>
      )}

      {session?.role === "WORKER" && workerId && (
        <>
          <p className={styles.location}>Signed in as {session.name}</p>

          {error && <p className={styles.errorText}>{error}</p>}

          {task === null && <p className={styles.empty}>No active task right now.</p>}

          {task && (
            <div className={styles.taskCard}>
              <span className={styles.statusBadge}>{task.status}</span>
              <div className={styles.containerId}>{task.container.id}</div>
              <div className={styles.location}>
                Block {task.container.block}, row {task.container.row}, bay {task.container.bay}, tier{" "}
                {task.container.tier}
              </div>
              {task.assignedEquipment && (
                <div className={styles.location}>
                  Equipment: {task.assignedEquipment.id} ({task.assignedEquipment.type})
                </div>
              )}

              {task.status === "DISPATCHED" && (
                <button className={styles.actionButton} disabled={busy} onClick={startTask}>
                  Start Task
                </button>
              )}
              {task.status === "IN_PROGRESS" && (
                <button className={styles.actionButton} disabled={busy} onClick={confirmRetrieval}>
                  Confirm Retrieval
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
