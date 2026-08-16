"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import styles from "./page.module.css";

interface AuditEventRow {
  id: string;
  taskId: string | null;
  agentAlertId: string | null;
  action: string;
  actor: string;
  detailsJson: string;
  createdAt: string;
  task: { container: { id: string } } | null;
  agentAlert: { type: string } | null;
}

const WINDOW_OPTIONS = [
  { label: "Last 1h", hours: 1 },
  { label: "Last 4h", hours: 4 },
  { label: "Last 8h", hours: 8 },
  { label: "Last 24h", hours: 24 },
];

const SPEED_OPTIONS = [1, 2, 5, 10];

async function api<T>(path: string): Promise<T> {
  const res = await fetch(path);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `Request to ${path} failed`);
  return data as T;
}

function eventLabel(ev: AuditEventRow): string {
  if (ev.task) return ev.task.container.id;
  if (ev.agentAlert) return `alert: ${ev.agentAlert.type.replace(/_/g, " ")}`;
  return "—";
}

function formatDetails(json: string): string {
  try {
    const parsed = JSON.parse(json);
    if (parsed && typeof parsed === "object" && Object.keys(parsed).length === 0) return "";
    return JSON.stringify(parsed);
  } catch {
    return "";
  }
}

/**
 * Real replay of what actually happened, built entirely from AuditEvent —
 * every mutating service already writes one, with a real timestamp. This
 * deliberately does NOT claim to reconstruct full yard/equipment state at
 * a point in time (no periodic snapshot exists for that beyond
 * CongestionSnapshot's lanes-only history) — it's an honest event-sequence
 * replay, not a fabricated "here's what the map looked like." Useful for
 * post-incident review and training: scrub or play through the shift and
 * see exactly what happened, in order, with real timestamps and actors.
 */
export default function HistoryPage() {
  const [windowHours, setWindowHours] = useState(4);
  const [events, setEvents] = useState<AuditEventRow[]>([]);
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(2);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const listEndRef = useRef<HTMLDivElement | null>(null);

  const refresh = useCallback(async (hours: number) => {
    setLoading(true);
    setError(null);
    try {
      const since = new Date(Date.now() - hours * 3_600_000).toISOString();
      const data = await api<{ events: AuditEventRow[] }>(`/api/audit?since=${since}&order=asc&limit=1000`);
      setEvents(data.events);
      setCursor(data.events.length > 0 ? data.events.length - 1 : 0);
      setPlaying(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => refresh(windowHours), 0);
    return () => clearTimeout(timeout);
  }, [windowHours, refresh]);

  useEffect(() => {
    if (!playing) return;
    const interval = setInterval(() => {
      setCursor((c) => {
        if (c >= events.length - 1) {
          setPlaying(false);
          return c;
        }
        return c + 1;
      });
    }, 1000 / speed);
    return () => clearInterval(interval);
  }, [playing, speed, events.length]);

  useEffect(() => {
    listEndRef.current?.scrollIntoView({ block: "end" });
  }, [cursor]);

  const revealed = events.slice(0, cursor + 1);
  const cursorEvent = events[cursor];

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <div className={styles.topbarLeft}>
          <Link href="/" className={styles.backLink}>
            ← Dashboard
          </Link>
          <div className={styles.divider} />
          <h1>Shift Timeline</h1>
        </div>
        <div className={styles.windowPicker}>
          {WINDOW_OPTIONS.map((opt) => (
            <button
              key={opt.hours}
              className={`${styles.windowButton} ${windowHours === opt.hours ? styles.windowButtonActive : ""}`}
              onClick={() => setWindowHours(opt.hours)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </header>

      {error && <div className={styles.errorBar}>{error}</div>}
      <p className={styles.caveat}>
        A real replay of what happened, in order — built from the audit trail, not a reconstruction of yard/equipment
        state at a point in time (that would need periodic full-state snapshots this system doesn&apos;t keep).
      </p>

      <div className={styles.body}>
        {loading && <p className={styles.emptyState}>Loading…</p>}
        {!loading && events.length === 0 && <p className={styles.emptyState}>No events in this window.</p>}

        {!loading && events.length > 0 && (
          <>
            <div className={styles.controls}>
              <button className={styles.playButton} onClick={() => setPlaying((p) => !p)} disabled={cursor >= events.length - 1 && !playing}>
                {playing ? "Pause" : "Play"}
              </button>
              <input
                type="range"
                aria-label="Timeline position"
                className={styles.scrubber}
                min={0}
                max={Math.max(0, events.length - 1)}
                value={cursor}
                onChange={(e) => {
                  setPlaying(false);
                  setCursor(Number(e.target.value));
                }}
              />
              <span className={styles.cursorTime}>
                {cursorEvent ? new Date(cursorEvent.createdAt).toLocaleTimeString() : "—"}
              </span>
              <div className={styles.speedPicker}>
                {SPEED_OPTIONS.map((s) => (
                  <button
                    key={s}
                    className={`${styles.speedButton} ${speed === s ? styles.speedButtonActive : ""}`}
                    onClick={() => setSpeed(s)}
                  >
                    {s}x
                  </button>
                ))}
              </div>
              <span className={styles.progressLabel}>
                {cursor + 1} / {events.length}
              </span>
            </div>

            <div className={styles.eventList}>
              {revealed.map((ev) => (
                <div key={ev.id} className={styles.eventRow}>
                  <span className={styles.eventTime}>{new Date(ev.createdAt).toLocaleTimeString()}</span>
                  <span className={styles.eventAction}>{ev.action.replace(/_/g, " ")}</span>
                  <span className={styles.eventSubject}>{eventLabel(ev)}</span>
                  <span className={styles.eventActor}>{ev.actor}</span>
                  <span className={styles.eventDetails}>{formatDetails(ev.detailsJson)}</span>
                </div>
              ))}
              <div ref={listEndRef} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
