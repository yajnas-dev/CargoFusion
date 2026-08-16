"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useLiveEvents } from "../useLiveEvents";
import { TOPICS } from "@/events/topics";
import styles from "./page.module.css";

type AlertStatus = "OPEN" | "ACKNOWLEDGED" | "APPLIED" | "DISMISSED";
type Severity = "LOW" | "MEDIUM" | "HIGH" | "URGENT";
type SuggestedActionType =
  | "UNBLOCK_LANE"
  | "REASSIGN_EQUIPMENT"
  | "REPRIORITIZE_TASK"
  | "FREE_STUCK_EQUIPMENT"
  | "INITIATE_RETRIEVAL"
  | "ESCALATE_TO_SUPERVISOR";

interface AgentAlert {
  id: string;
  type: string;
  status: AlertStatus;
  severity: Severity;
  taskId: string | null;
  subjectJson: string;
  suggestedActionType: SuggestedActionType;
  explanation: string;
  rankScore: number | null;
  detectedAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  task: { container: { id: string } } | null;
}

interface AgentConfig {
  agingTaskThresholdMs: number;
  congestionHotspotThreshold: number;
  congestionSustainedCycles: number;
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

const SEVERITY_LABEL: Record<Severity, string> = { URGENT: "Urgent", HIGH: "High", MEDIUM: "Medium", LOW: "Low" };

function relativeTime(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

export default function AgentPage() {
  const [alerts, setAlerts] = useState<AgentAlert[]>([]);
  const [running, setRunning] = useState(false);
  const [config, setConfig] = useState<AgentConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clock, setClock] = useState("");
  const [pending, setPending] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [alertsData, statusData, configData] = await Promise.all([
        api<{ alerts: AgentAlert[] }>("/api/agent/alerts"),
        api<{ running: boolean }>("/api/agent/status"),
        api<{ config: AgentConfig }>("/api/agent/config"),
      ]);
      setAlerts(alertsData.alerts);
      setRunning(statusData.running);
      setConfig(configData.config);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    const timeout = setTimeout(refresh, 0);
    const interval = setInterval(refresh, 20000); // fallback poll in case SSE is silently disconnected
    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, [refresh]);

  useEffect(() => {
    const update = () => setClock(new Date().toLocaleTimeString());
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, []);

  useLiveEvents({
    [TOPICS.AGENT_ALERT_RAISED]: () => refresh(),
    [TOPICS.AGENT_ALERT_RESOLVED]: () => refresh(),
  });

  async function toggleRunning() {
    setError(null);
    setPending("toggle-running");
    try {
      await api(running ? "/api/agent/stop" : "/api/agent/start", { method: "POST" });
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(null);
    }
  }

  async function apply(alertId: string) {
    setError(null);
    setPending(`apply:${alertId}`);
    try {
      await api(`/api/agent/alerts/${alertId}/apply`, { method: "POST" });
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(null);
    }
  }

  async function dismiss(alertId: string) {
    setError(null);
    setPending(`dismiss:${alertId}`);
    try {
      await api(`/api/agent/alerts/${alertId}/dismiss`, { method: "POST", body: JSON.stringify({}) });
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(null);
    }
  }

  async function saveConfig(partial: Partial<AgentConfig>) {
    try {
      const data = await api<{ config: AgentConfig }>("/api/agent/config", {
        method: "POST",
        body: JSON.stringify(partial),
      });
      setConfig(data.config);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const openAlerts = alerts.filter((a) => a.status === "OPEN" || a.status === "ACKNOWLEDGED");
  const resolvedAlerts = alerts.filter((a) => a.status === "APPLIED" || a.status === "DISMISSED").slice(0, 20);
  const openBySeverity = (severity: Severity) => openAlerts.filter((a) => a.severity === severity).length;

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <div className={styles.topbarLeft}>
          <Link href="/" className={styles.backLink}>
            ← Dashboard
          </Link>
          <div className={styles.divider} />
          <h1>Container Management Agent</h1>
          <span className={`${styles.liveBadge} ${running ? styles.liveBadgeOn : ""}`}>
            <span className={styles.liveDot} />
            {running ? "Running" : "Stopped"}
          </span>
        </div>
        <div className={styles.topbarRight}>
          {openAlerts.length > 0 && (
            <span className={styles.blockedBadge}>
              {openAlerts.length} open alert{openAlerts.length === 1 ? "" : "s"}
            </span>
          )}
          <span className={styles.clock}>{clock}</span>
          <Link href="/simulation" className={styles.workerLink}>
            Simulation →
          </Link>
        </div>
      </header>

      {error && <div className={styles.errorBar}>{error}</div>}

      <div className={styles.body}>
        <div className={styles.feedArea}>
          <section>
            <h2 className={styles.feedHeading}>Open ({openAlerts.length})</h2>
            {openAlerts.length === 0 && <p className={styles.emptyState}>No open alerts. The agent is watching.</p>}
            <div className={styles.alertList}>
              {openAlerts.map((alert) => (
                <AlertCard
                  key={alert.id}
                  alert={alert}
                  pending={pending}
                  onApply={() => apply(alert.id)}
                  onDismiss={() => dismiss(alert.id)}
                />
              ))}
            </div>
          </section>

          {resolvedAlerts.length > 0 && (
            <section className={styles.resolvedSection}>
              <h2 className={styles.feedHeading}>Recently resolved</h2>
              <div className={styles.alertList}>
                {resolvedAlerts.map((alert) => (
                  <AlertCard key={alert.id} alert={alert} pending={pending} resolved />
                ))}
              </div>
            </section>
          )}
        </div>

        <aside className={styles.controls}>
          <section className={styles.statGrid}>
            <MiniStat label="Open (Urgent)" value={openBySeverity("URGENT")} accent={openBySeverity("URGENT") > 0 ? "red" : undefined} />
            <MiniStat label="Open (High)" value={openBySeverity("HIGH")} />
            <MiniStat label="Open (Medium)" value={openBySeverity("MEDIUM")} />
            <MiniStat label="Open (Low)" value={openBySeverity("LOW")} />
          </section>

          <section className={styles.section}>
            <h2>Agent Monitor</h2>
            <p className={styles.sectionHint}>
              Continuously watches yard/task state and raises ranked, explained alerts. Never acts on its own —
              every effect here goes through Apply, which calls the same deterministic action a supervisor would
              use manually.
            </p>
            <button
              className={running ? styles.stopButton : styles.startButton}
              disabled={pending === "toggle-running"}
              onClick={toggleRunning}
            >
              {running ? "Stop Agent Monitor" : "Start Agent Monitor"}
            </button>
          </section>

          {config && (
            <section className={styles.section}>
              <h2>Thresholds</h2>
              <label className={styles.fieldLabel}>
                Aging task threshold (minutes)
                <input
                  type="number"
                  min={1}
                  className={styles.numberInput}
                  defaultValue={Math.round(config.agingTaskThresholdMs / 60000)}
                  onBlur={(e) => {
                    const minutes = Number(e.target.value);
                    if (minutes > 0) saveConfig({ agingTaskThresholdMs: minutes * 60000 });
                  }}
                />
              </label>
              <label className={styles.fieldLabel}>
                Congestion hotspot threshold
                <input
                  type="number"
                  min={1}
                  step={0.1}
                  className={styles.numberInput}
                  defaultValue={config.congestionHotspotThreshold}
                  onBlur={(e) => {
                    const value = Number(e.target.value);
                    if (value > 0) saveConfig({ congestionHotspotThreshold: value });
                  }}
                />
              </label>
              <label className={styles.fieldLabel}>
                Congestion sustained cycles
                <input
                  type="number"
                  min={1}
                  className={styles.numberInput}
                  defaultValue={config.congestionSustainedCycles}
                  onBlur={(e) => {
                    const value = Number(e.target.value);
                    if (value > 0) saveConfig({ congestionSustainedCycles: value });
                  }}
                />
              </label>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

function AlertCard({
  alert,
  pending,
  onApply,
  onDismiss,
  resolved,
}: {
  alert: AgentAlert;
  pending: string | null;
  onApply?: () => void;
  onDismiss?: () => void;
  resolved?: boolean;
}) {
  const canApply = alert.suggestedActionType !== "ESCALATE_TO_SUPERVISOR";
  return (
    <div className={`${styles.alertCard} ${styles[`severity${alert.severity}`]}`}>
      <div className={styles.alertCardHeader}>
        <span className={styles.alertType}>{alert.type.replace(/_/g, " ")}</span>
        <span className={styles.alertSeverity}>{SEVERITY_LABEL[alert.severity]}</span>
      </div>
      <p className={styles.alertExplanation}>{alert.explanation}</p>
      <div className={styles.alertMeta}>
        {alert.task?.container && <span>Container {alert.task.container.id}</span>}
        <span>{relativeTime(alert.detectedAt)}</span>
        {resolved && alert.status === "APPLIED" && <span className={styles.resolvedTag}>Applied by {alert.resolvedBy}</span>}
        {resolved && alert.status === "DISMISSED" && <span className={styles.resolvedTag}>Dismissed by {alert.resolvedBy}</span>}
      </div>
      {!resolved && (
        <div className={styles.alertActions}>
          {canApply && (
            <button className={styles.applyButton} disabled={pending === `apply:${alert.id}`} onClick={onApply}>
              Apply
            </button>
          )}
          <button className={styles.dismissButton} disabled={pending === `dismiss:${alert.id}`} onClick={onDismiss}>
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}

function MiniStat({ label, value, accent }: { label: string; value: string | number; accent?: "red" }) {
  return (
    <div className={styles.miniStat}>
      <span className={styles.miniStatLabel}>{label}</span>
      <span className={`${styles.miniStatValue} ${accent === "red" ? styles.miniStatValueRed : ""}`}>{value}</span>
    </div>
  );
}
