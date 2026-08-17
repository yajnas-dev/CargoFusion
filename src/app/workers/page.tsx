"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useLiveEvents } from "../useLiveEvents";
import { TOPICS } from "@/events/topics";
import styles from "../equipment/page.module.css";

type WorkerStatus = "AVAILABLE" | "BUSY" | "OFF_SHIFT";

interface WorkerRow {
  id: string;
  name: string;
  status: WorkerStatus;
  tasks: { id: string; status: string; container: { id: string } }[];
}

async function api<T>(path: string): Promise<T> {
  const res = await fetch(path);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `Request to ${path} failed`);
  return data as T;
}

export default function WorkersPage() {
  const [workers, setWorkers] = useState<WorkerRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await api<{ workers: WorkerRow[] }>("/api/workers");
      setWorkers(data.workers);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    const timeout = setTimeout(refresh, 0);
    const interval = setInterval(refresh, 15000);
    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, [refresh]);

  useLiveEvents({ [TOPICS.TASK_CHANGED]: () => refresh(), [TOPICS.WORKER_CHANGED]: () => refresh() });

  const availableCount = workers.filter((w) => w.status === "AVAILABLE").length;

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <div className={styles.topbarLeft}>
          <Link href="/" className={styles.backLink}>
            ← Dashboard
          </Link>
          <div className={styles.divider} />
          <h1>Workers</h1>
          <span className={styles.countBadge}>
            {availableCount} / {workers.length} available
          </span>
        </div>
      </header>

      {error && <div className={styles.errorBar}>{error}</div>}

      <div className={styles.body}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Status</th>
              <th>Active task</th>
            </tr>
          </thead>
          <tbody>
            {workers.map((w) => {
              const active = w.tasks[0];
              return (
                <tr key={w.id}>
                  <td>{w.id}</td>
                  <td>{w.name}</td>
                  <td>
                    <span className={`${styles.statusBadge} ${styles[`status${w.status}`]}`}>{w.status}</span>
                  </td>
                  <td>{active ? `${active.container.id} (${active.status})` : "—"}</td>
                </tr>
              );
            })}
            {workers.length === 0 && (
              <tr>
                <td colSpan={4}>No workers on record.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
