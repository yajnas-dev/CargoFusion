"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useLiveEvents } from "../useLiveEvents";
import { TOPICS } from "@/events/topics";
import styles from "./page.module.css";

type IncidentType = "EQUIPMENT_OFFLINE" | "LANE_BLOCKED";
type IncidentStatus = "OPEN" | "RESOLVED";

interface IncidentRow {
  id: string;
  type: IncidentType;
  subjectId: string;
  status: IncidentStatus;
  cause: string | null;
  reportedBy: string;
  startedAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
}

interface EquipmentOption {
  id: string;
  status: string;
}

interface LaneOption {
  id: string;
  blocked: boolean;
  fromNodeId: string;
  toNodeId: string;
}

interface LaneBlockPreview {
  affectedTaskCount: number;
  affected: { taskId: string; containerId: string; priority: string; hasAlternateRoute: boolean; alternateEstimatedSeconds: number | null }[];
}

interface EquipmentOfflinePreview {
  wouldImpactActiveTask: boolean;
  currentlyClaimedByTask: { taskId: string; containerId: string; priority: string } | null;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `Request to ${path} failed`);
  return data as T;
}

function durationSince(iso: string, until?: string | null): string {
  const ms = (until ? new Date(until).getTime() : Date.now()) - new Date(iso).getTime();
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export default function IncidentsPage() {
  const [incidents, setIncidents] = useState<IncidentRow[]>([]);
  const [equipment, setEquipment] = useState<EquipmentOption[]>([]);
  const [lanes, setLanes] = useState<LaneOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  const [reportType, setReportType] = useState<IncidentType>("EQUIPMENT_OFFLINE");
  const [reportSubjectId, setReportSubjectId] = useState("");
  const [reportCause, setReportCause] = useState("");
  const [preview, setPreview] = useState<LaneBlockPreview | EquipmentOfflinePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [incidentData, equipmentData, yardData] = await Promise.all([
        api<{ incidents: IncidentRow[] }>("/api/incidents"),
        api<{ equipment: EquipmentOption[] }>("/api/equipment"),
        api<{ lanes: LaneOption[] }>("/api/yard"),
      ]);
      setIncidents(incidentData.incidents);
      setEquipment(equipmentData.equipment);
      setLanes(yardData.lanes);
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

  useLiveEvents({
    [TOPICS.INCIDENT_CHANGED]: () => refresh(),
    [TOPICS.YARD_EQUIPMENT_CHANGED]: () => refresh(),
    [TOPICS.YARD_LANE_CHANGED]: () => refresh(),
  });

  // What-if impact preview: check what reporting this incident would affect
  // before actually reporting it, reusing the same deterministic impact
  // logic the detectors use, in a read-only mode (Port Operations Roadmap
  // Phase 2: What-If Preview).
  useEffect(() => {
    const timeout = setTimeout(async () => {
      if (!reportSubjectId) {
        setPreview(null);
        return;
      }
      setPreviewLoading(true);
      try {
        if (reportType === "EQUIPMENT_OFFLINE") {
          const data = await api<{ preview: EquipmentOfflinePreview }>(
            `/api/preview/equipment-offline?equipmentId=${encodeURIComponent(reportSubjectId)}`,
          );
          setPreview(data.preview);
        } else {
          const data = await api<{ preview: LaneBlockPreview }>(
            `/api/preview/lane-block?laneId=${encodeURIComponent(reportSubjectId)}`,
          );
          setPreview(data.preview);
        }
      } catch {
        setPreview(null);
      } finally {
        setPreviewLoading(false);
      }
    }, reportSubjectId ? 200 : 0);
    return () => clearTimeout(timeout);
  }, [reportType, reportSubjectId]);

  const open = incidents.filter((i) => i.status === "OPEN");
  const resolved = incidents.filter((i) => i.status === "RESOLVED").slice(0, 20);

  const reportableEquipment = equipment.filter((e) => e.status === "AVAILABLE");
  const reportableLanes = lanes.filter((l) => !l.blocked);

  async function resolveIncident(id: string) {
    setError(null);
    setPending(id);
    try {
      await api(`/api/incidents/${id}/resolve`, { method: "POST", body: JSON.stringify({}) });
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(null);
    }
  }

  async function submitReport(e: React.FormEvent) {
    e.preventDefault();
    if (!reportSubjectId) return;
    setError(null);
    setPending("report");
    try {
      await api("/api/incidents", {
        method: "POST",
        body: JSON.stringify({ type: reportType, subjectId: reportSubjectId, cause: reportCause || undefined }),
      });
      setReportSubjectId("");
      setReportCause("");
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(null);
    }
  }

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <div className={styles.topbarLeft}>
          <Link href="/" className={styles.backLink}>
            ← Dashboard
          </Link>
          <div className={styles.divider} />
          <h1>Incidents</h1>
          <span className={styles.countBadge}>{open.length} open</span>
        </div>
      </header>

      {error && <div className={styles.errorBar}>{error}</div>}

      <div className={styles.body}>
        <div className={styles.feedArea}>
          <section>
            <h2 className={styles.feedHeading}>Open ({open.length})</h2>
            {open.length === 0 && <p className={styles.emptyState}>No open incidents.</p>}
            <div className={styles.incidentList}>
              {open.map((inc) => (
                <div key={inc.id} className={styles.card}>
                  <div className={styles.cardHeader}>
                    <span className={styles.typeTag}>{inc.type.replace(/_/g, " ")}</span>
                    <span className={styles.subjectId}>{inc.subjectId}</span>
                    <span className={styles.duration}>open {durationSince(inc.startedAt)}</span>
                  </div>
                  {inc.cause && <p className={styles.cause}>{inc.cause}</p>}
                  <div className={styles.cardMeta}>
                    Reported by {inc.reportedBy} · {new Date(inc.startedAt).toLocaleString()}
                  </div>
                  <button
                    className={styles.resolveButton}
                    disabled={pending === inc.id}
                    onClick={() => resolveIncident(inc.id)}
                  >
                    Resolve
                  </button>
                </div>
              ))}
            </div>
          </section>

          {resolved.length > 0 && (
            <section>
              <h2 className={styles.feedHeading}>Recently resolved</h2>
              <div className={styles.incidentList}>
                {resolved.map((inc) => (
                  <div key={inc.id} className={`${styles.card} ${styles.cardResolved}`}>
                    <div className={styles.cardHeader}>
                      <span className={styles.typeTag}>{inc.type.replace(/_/g, " ")}</span>
                      <span className={styles.subjectId}>{inc.subjectId}</span>
                      <span className={styles.duration}>lasted {durationSince(inc.startedAt, inc.resolvedAt)}</span>
                    </div>
                    <div className={styles.cardMeta}>Resolved by {inc.resolvedBy}</div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        <aside className={styles.controls}>
          <h2>Report Incident</h2>
          <form className={styles.reportForm} onSubmit={submitReport}>
            <label className={styles.fieldLabel}>
              Type
              <select
                className={styles.select}
                value={reportType}
                onChange={(e) => {
                  setReportType(e.target.value as IncidentType);
                  setReportSubjectId("");
                }}
              >
                <option value="EQUIPMENT_OFFLINE">Equipment offline</option>
                <option value="LANE_BLOCKED">Lane blocked</option>
              </select>
            </label>
            <label className={styles.fieldLabel}>
              {reportType === "EQUIPMENT_OFFLINE" ? "Equipment" : "Lane"}
              <select
                className={styles.select}
                value={reportSubjectId}
                onChange={(e) => setReportSubjectId(e.target.value)}
              >
                <option value="">Choose…</option>
                {reportType === "EQUIPMENT_OFFLINE"
                  ? reportableEquipment.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.id}
                      </option>
                    ))
                  : reportableLanes.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.fromNodeId} → {l.toNodeId}
                      </option>
                    ))}
              </select>
            </label>
            <label className={styles.fieldLabel}>
              Cause (optional)
              <input
                type="text"
                className={styles.textInput}
                value={reportCause}
                onChange={(e) => setReportCause(e.target.value)}
                placeholder="e.g. hydraulic fault"
              />
            </label>

            {reportSubjectId && (
              <div className={styles.previewBox}>
                {previewLoading && <span className={styles.previewLoading}>Checking impact…</span>}
                {!previewLoading && preview && "affected" in preview && (
                  <>
                    {preview.affectedTaskCount === 0 ? (
                      <span className={styles.previewOk}>No active task&apos;s route crosses this lane — safe to block.</span>
                    ) : (
                      <>
                        <span className={styles.previewWarn}>
                          Would affect {preview.affectedTaskCount} active task{preview.affectedTaskCount === 1 ? "" : "s"}:
                        </span>
                        <ul className={styles.previewList}>
                          {preview.affected.map((a) => (
                            <li key={a.taskId}>
                              {a.containerId} ({a.priority}) —{" "}
                              {a.hasAlternateRoute
                                ? `alternate route exists (~${Math.round(a.alternateEstimatedSeconds ?? 0)}s)`
                                : "no alternate route available"}
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </>
                )}
                {!previewLoading && preview && "wouldImpactActiveTask" in preview && (
                  <>
                    {!preview.wouldImpactActiveTask ? (
                      <span className={styles.previewOk}>Not currently claimed by an active task — safe to take offline.</span>
                    ) : (
                      <span className={styles.previewWarn}>
                        Currently assigned to task for container {preview.currentlyClaimedByTask?.containerId} (
                        {preview.currentlyClaimedByTask?.priority}) — that task will need reassignment.
                      </span>
                    )}
                  </>
                )}
              </div>
            )}

            <button type="submit" className={styles.reportButton} disabled={!reportSubjectId || pending === "report"}>
              Report incident
            </button>
          </form>
        </aside>
      </div>
    </div>
  );
}
