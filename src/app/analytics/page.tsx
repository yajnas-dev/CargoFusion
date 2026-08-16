"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import styles from "./page.module.css";

interface DurationSummary {
  sampleSize: number;
  avgSeconds: number | null;
}

interface UtilizationSummary {
  available: number;
  busy: number;
  offlineOrOffShift: number;
  total: number;
  avgActiveTaskCount: number | null;
}

interface IncidentDurationSummary {
  type: string;
  resolvedCount: number;
  avgResolutionSeconds: number | null;
}

interface CongestionTrend {
  laneId: string;
  currentWeight: number;
  projection: { inMinutes: number; projectedWeight: number } | null;
}

interface AnalyticsSummary {
  windowHours: number;
  throughput: { completedInWindow: number; windowHours: number; perHour: number };
  avgRetrievalTime: DurationSummary;
  avgQueueTime: DurationSummary;
  avgUrgentQueueTime: DurationSummary;
  taskStatusCounts: Record<string, number>;
  requestOutcomeCounts: Record<string, number>;
  equipmentUtilization: UtilizationSummary;
  workerUtilization: UtilizationSummary;
  congestion: { avgCongestionWeight: number; blockedLaneCount: number; totalLaneCount: number };
  alertVolumeByType: Record<string, number>;
  incidents: { open: number; resolvedByType: IncidentDurationSummary[] };
}

async function api<T>(path: string): Promise<T> {
  const res = await fetch(path);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `Request to ${path} failed`);
  return data as T;
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

const OUTCOME_TONE: Record<string, "good" | "warning" | "critical"> = {
  READY: "good",
  AMBIGUOUS: "warning",
  NEEDS_ESCALATION: "warning",
  NOT_FOUND: "critical",
  NO_EQUIPMENT: "critical",
  NO_ROUTE: "critical",
};

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className={styles.statTile}>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue}>{value}</span>
      {sub && <span className={styles.statSub}>{sub}</span>}
    </div>
  );
}

function MagnitudeBars({ entries, toneOf }: { entries: [string, number][]; toneOf?: (key: string) => string }) {
  const max = Math.max(1, ...entries.map(([, v]) => v));
  return (
    <div className={styles.barList}>
      {entries.map(([key, value]) => (
        <div key={key} className={styles.barRow}>
          <span className={styles.barLabel}>{key.replace(/_/g, " ")}</span>
          <div className={styles.barTrack}>
            <div
              className={`${styles.barFill} ${toneOf ? styles[`tone${toneOf(key)}`] : styles.toneNeutral}`}
              style={{ width: `${(value / max) * 100}%` }}
            />
          </div>
          <span className={styles.barValue}>{value}</span>
        </div>
      ))}
      {entries.length === 0 && <p className={styles.emptyState}>No data yet.</p>}
    </div>
  );
}

function UtilizationMeter({ label, summary }: { label: string; summary: UtilizationSummary }) {
  const total = summary.total || 1;
  return (
    <div className={styles.meterBlock}>
      <div className={styles.meterHeader}>
        <span>{label}</span>
        <span className={styles.meterTotal}>{summary.total} total</span>
      </div>
      <div className={styles.meterTrack}>
        <div className={styles.meterSegAvailable} style={{ width: `${(summary.available / total) * 100}%` }} />
        <div className={styles.meterSegBusy} style={{ width: `${(summary.busy / total) * 100}%` }} />
        <div className={styles.meterSegOffline} style={{ width: `${(summary.offlineOrOffShift / total) * 100}%` }} />
      </div>
      <div className={styles.meterLegend}>
        <span>
          <i className={styles.dotAvailable} /> {summary.available} available
        </span>
        <span>
          <i className={styles.dotBusy} /> {summary.busy} busy
        </span>
        <span>
          <i className={styles.dotOffline} /> {summary.offlineOrOffShift} offline
        </span>
      </div>
      {summary.avgActiveTaskCount !== null && (
        <div className={styles.meterFootnote}>Avg active tasks per unit: {summary.avgActiveTaskCount.toFixed(2)}</div>
      )}
    </div>
  );
}

export default function AnalyticsPage() {
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [congestionTrends, setCongestionTrends] = useState<CongestionTrend[]>([]);
  const [windowHours, setWindowHours] = useState(24);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (hours: number) => {
    try {
      const [summaryData, trendData] = await Promise.all([
        api<{ summary: AnalyticsSummary }>(`/api/analytics?windowHours=${hours}`),
        api<{ trends: CongestionTrend[] }>("/api/analytics/congestion-trend"),
      ]);
      setSummary(summaryData.summary);
      setCongestionTrends(trendData.trends);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => refresh(windowHours), 0);
    const interval = setInterval(() => refresh(windowHours), 30000);
    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowHours]);

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <div className={styles.topbarLeft}>
          <Link href="/" className={styles.backLink}>
            ← Dashboard
          </Link>
          <div className={styles.divider} />
          <h1>Analytics</h1>
        </div>
        <div className={styles.windowPicker}>
          {[6, 24, 24 * 7].map((h) => (
            <button
              key={h}
              className={`${styles.windowButton} ${windowHours === h ? styles.windowButtonActive : ""}`}
              onClick={() => setWindowHours(h)}
            >
              {h < 24 ? `${h}h` : `${h / 24}d`}
            </button>
          ))}
        </div>
      </header>

      {error && <div className={styles.errorBar}>{error}</div>}

      {summary && (
        <div className={styles.body}>
          <section className={styles.statRow}>
            <StatTile
              label={`Throughput (last ${summary.throughput.windowHours}h)`}
              value={`${summary.throughput.completedInWindow}`}
              sub={`${summary.throughput.perHour.toFixed(2)} / hour`}
            />
            <StatTile
              label="Avg retrieval time"
              value={formatDuration(summary.avgRetrievalTime.avgSeconds)}
              sub={`n=${summary.avgRetrievalTime.sampleSize} completed`}
            />
            <StatTile
              label="Avg queue time (request → approve)"
              value={formatDuration(summary.avgQueueTime.avgSeconds)}
              sub={`n=${summary.avgQueueTime.sampleSize}`}
            />
            <StatTile
              label="Avg URGENT queue time"
              value={formatDuration(summary.avgUrgentQueueTime.avgSeconds)}
              sub={`n=${summary.avgUrgentQueueTime.sampleSize}`}
            />
            <StatTile
              label="Avg congestion"
              value={`${summary.congestion.avgCongestionWeight.toFixed(2)}x`}
              sub={`${summary.congestion.blockedLaneCount} / ${summary.congestion.totalLaneCount} lanes blocked`}
            />
            <StatTile label="Open incidents" value={`${summary.incidents.open}`} />
          </section>

          <div className={styles.grid2}>
            <div className={styles.panel}>
              <h2>Tasks by status</h2>
              <MagnitudeBars entries={Object.entries(summary.taskStatusCounts)} />
            </div>
            <div className={styles.panel}>
              <h2>Request outcomes</h2>
              <MagnitudeBars entries={Object.entries(summary.requestOutcomeCounts)} toneOf={(k) => OUTCOME_TONE[k] ?? "neutral"} />
            </div>
          </div>

          <div className={styles.grid2}>
            <div className={styles.panel}>
              <h2>Equipment utilization</h2>
              <UtilizationMeter label="Equipment" summary={summary.equipmentUtilization} />
            </div>
            <div className={styles.panel}>
              <h2>Worker utilization</h2>
              <UtilizationMeter label="Workers" summary={summary.workerUtilization} />
            </div>
          </div>

          <div className={styles.panel}>
            <h2>Congestion trend (top 10 lanes, last 30 min)</h2>
            <p className={styles.trendCaveat}>
              Linear extrapolation from the oldest to newest reading in the window — a straight-line projection, not a
              forecast model. Snapshots are recorded once per Container Management Agent cycle, so this fills in once
              the agent has been running for a few cycles.
            </p>
            {congestionTrends.length === 0 && (
              <p className={styles.emptyState}>No snapshots yet — start the Container Management Agent to begin recording.</p>
            )}
            {congestionTrends.length > 0 && (
              <table className={styles.trendTable}>
                <thead>
                  <tr>
                    <th>Lane</th>
                    <th>Current</th>
                    <th>Projected (+15 min)</th>
                  </tr>
                </thead>
                <tbody>
                  {congestionTrends.map((t) => {
                    const delta = t.projection ? t.projection.projectedWeight - t.currentWeight : null;
                    return (
                      <tr key={t.laneId}>
                        <td>{t.laneId}</td>
                        <td>{t.currentWeight.toFixed(2)}x</td>
                        <td>
                          {t.projection ? (
                            <span className={delta !== null && delta > 0.05 ? styles.trendUp : delta !== null && delta < -0.05 ? styles.trendDown : undefined}>
                              {t.projection.projectedWeight.toFixed(2)}x
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          <div className={styles.grid2}>
            <div className={styles.panel}>
              <h2>Agent alert volume by type</h2>
              <MagnitudeBars entries={Object.entries(summary.alertVolumeByType).sort((a, b) => b[1] - a[1])} />
            </div>
            <div className={styles.panel}>
              <h2>Incident resolution time by type</h2>
              {summary.incidents.resolvedByType.length === 0 && (
                <p className={styles.emptyState}>No resolved incidents yet.</p>
              )}
              <div className={styles.incidentStatRow}>
                {summary.incidents.resolvedByType.map((r) => (
                  <StatTile
                    key={r.type}
                    label={r.type.replace(/_/g, " ")}
                    value={formatDuration(r.avgResolutionSeconds)}
                    sub={`n=${r.resolvedCount} resolved`}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
