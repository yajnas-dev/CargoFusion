"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import styles from "./page.module.css";

interface Worker {
  id: string;
  name: string;
  status: "AVAILABLE" | "BUSY" | "OFF_SHIFT";
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
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [workerId, setWorkerId] = useState("");
  const [task, setTask] = useState<ActiveTask | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadWorkers = useCallback(async () => {
    const data = await api<{ workers: Worker[] }>("/api/workers");
    setWorkers(data.workers);
  }, []);

  const loadActiveTask = useCallback(async (id: string) => {
    const data = await api<{ task: ActiveTask | null }>(`/api/workers/${id}/active-task`);
    setTask(data.task);
  }, []);

  useEffect(() => {
    const timeout = setTimeout(loadWorkers, 0);
    const interval = setInterval(loadWorkers, 5000); // keeps each option's (AVAILABLE/BUSY) label current
    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, [loadWorkers]);

  useEffect(() => {
    if (!workerId) return;
    const timeout = setTimeout(() => loadActiveTask(workerId), 0);
    const interval = setInterval(() => loadActiveTask(workerId), 5000);
    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, [workerId, loadActiveTask]);

  async function startTask() {
    if (!task) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/tasks/${task.id}/start`, { method: "POST", body: JSON.stringify({ workerId }) });
      await loadActiveTask(workerId);
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
      await api(`/api/tasks/${task.id}/confirm`, { method: "POST", body: JSON.stringify({ workerId }) });
      await loadActiveTask(workerId);
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

      <select
        value={workerId}
        onChange={(e) => {
          setWorkerId(e.target.value);
          setTask(undefined);
        }}
        className={styles.select}
      >
        <option value="">Select worker…</option>
        {workers.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name} ({w.status})
          </option>
        ))}
      </select>

      {error && <p className={styles.errorText}>{error}</p>}

      {workerId && task === null && <p className={styles.empty}>No active task right now.</p>}

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
    </div>
  );
}
