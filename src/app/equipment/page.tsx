"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useLiveEvents } from "../useLiveEvents";
import { TOPICS } from "@/events/topics";
import { CraneIcon, TruckIcon } from "../icons";
import styles from "./page.module.css";

type EquipmentType = "YARD_TRUCK" | "CRANE";
type EquipmentStatus = "AVAILABLE" | "BUSY" | "OFFLINE";

interface EquipmentRow {
  id: string;
  type: EquipmentType;
  status: EquipmentStatus;
  capacityKg: number;
  currentNodeId: string;
  blockId: string | null;
  blockName: string | null;
  inTransit: boolean;
  activeTaskCount: number;
}

async function api<T>(path: string): Promise<T> {
  const res = await fetch(path);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `Request to ${path} failed`);
  return data as T;
}

export default function EquipmentPage() {
  const [equipment, setEquipment] = useState<EquipmentRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<"ALL" | EquipmentType>("ALL");

  const refresh = useCallback(async () => {
    try {
      const data = await api<{ equipment: EquipmentRow[] }>("/api/equipment");
      setEquipment(data.equipment);
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

  useLiveEvents({ [TOPICS.YARD_EQUIPMENT_CHANGED]: () => refresh() });

  const visible = equipment.filter((e) => typeFilter === "ALL" || e.type === typeFilter);
  const overloaded = [...visible].sort((a, b) => b.activeTaskCount - a.activeTaskCount).slice(0, 1)[0];
  const maxWorkload = overloaded?.activeTaskCount ?? 0;

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <div className={styles.topbarLeft}>
          <Link href="/" className={styles.backLink}>
            ← Dashboard
          </Link>
          <div className={styles.divider} />
          <h1>Equipment</h1>
          <span className={styles.countBadge}>{visible.length}</span>
        </div>
        <div className={styles.filters}>
          {(["ALL", "CRANE", "YARD_TRUCK"] as const).map((t) => (
            <button
              key={t}
              className={`${styles.filterButton} ${typeFilter === t ? styles.filterButtonActive : ""}`}
              onClick={() => setTypeFilter(t)}
            >
              {t === "ALL" ? "All" : t === "CRANE" ? "Cranes" : "Yard Trucks"}
            </button>
          ))}
        </div>
      </header>

      {error && <div className={styles.errorBar}>{error}</div>}

      <div className={styles.body}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>ID</th>
              <th>Type</th>
              <th>Status</th>
              <th>Capacity</th>
              <th>Location</th>
              <th>Active tasks</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((e) => (
              <tr key={e.id}>
                <td className={styles.idCell}>{e.id}</td>
                <td className={styles.typeCell}>
                  {e.type === "CRANE" ? <CraneIcon size={16} /> : <TruckIcon size={16} />}
                  {e.type === "CRANE" ? "Crane" : "Yard Truck"}
                </td>
                <td>
                  <span className={`${styles.statusBadge} ${styles[`status${e.status}`]}`}>{e.status}</span>
                  {e.inTransit && <span className={styles.transitTag}>in transit</span>}
                </td>
                <td>{e.capacityKg.toLocaleString()} kg</td>
                <td>
                  {e.blockName ?? e.blockId ?? "—"} <span className={styles.nodeId}>({e.currentNodeId})</span>
                </td>
                <td>
                  <span className={e.activeTaskCount >= 2 && e.activeTaskCount === maxWorkload ? styles.overloadedCount : ""}>
                    {e.activeTaskCount}
                  </span>
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={6}>No equipment matches this filter.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
