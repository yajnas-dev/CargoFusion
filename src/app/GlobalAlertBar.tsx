"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { useLiveEvents } from "./useLiveEvents";
import { TOPICS } from "@/events/topics";
import styles from "./GlobalAlertBar.module.css";

interface UrgentAlert {
  id: string;
  type: string;
  status: string;
  severity: string;
}

interface OpenIncident {
  id: string;
  type: string;
  subjectId: string;
}

async function api<T>(path: string): Promise<T | null> {
  const res = await fetch(path);
  if (!res.ok) return null;
  return (await res.json()) as T;
}

/**
 * Cross-page notification surface (Port Operations Roadmap Phase 2: Global
 * Notification Surface) — before this, alerts were trapped on `/agent`
 * with only a badge count elsewhere. Deliberately narrow: only URGENT
 * open agent alerts and open incidents surface here, since everything
 * else already has a page-local badge/count. Showing every open alert
 * globally would just duplicate those and train operators to ignore it.
 */
export default function GlobalAlertBar() {
  const pathname = usePathname();
  const [urgentAlerts, setUrgentAlerts] = useState<UrgentAlert[]>([]);
  const [openIncidents, setOpenIncidents] = useState<OpenIncident[]>([]);
  const [dismissed, setDismissed] = useState(false);
  const prevTotalRef = useRef(0);

  const skip = pathname === "/login";

  const refresh = useCallback(async () => {
    const [alertData, incidentData] = await Promise.all([
      api<{ alerts: UrgentAlert[] }>("/api/agent/alerts?status=OPEN"),
      api<{ incidents: OpenIncident[] }>("/api/incidents?status=OPEN"),
    ]);
    const urgent = (alertData?.alerts ?? []).filter((a) => a.severity === "URGENT");
    const incidents = incidentData?.incidents ?? [];
    setUrgentAlerts(urgent);
    setOpenIncidents(incidents);
    // A newly-raised urgent item should reopen the bar even if a previous
    // one was dismissed — compared here (inside the async refresh) rather
    // than in a separate effect keyed on the counts, which would set state
    // synchronously in the effect body.
    const total = urgent.length + incidents.length;
    if (total > prevTotalRef.current) setDismissed(false);
    prevTotalRef.current = total;
  }, []);

  useEffect(() => {
    if (skip) return;
    const timeout = setTimeout(refresh, 0);
    const interval = setInterval(refresh, 20000);
    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, [skip, refresh]);

  useLiveEvents(
    skip
      ? {}
      : {
          [TOPICS.AGENT_ALERT_RAISED]: () => refresh(),
          [TOPICS.AGENT_ALERT_RESOLVED]: () => refresh(),
          [TOPICS.INCIDENT_CHANGED]: () => refresh(),
        },
  );

  if (skip || dismissed) return null;

  const total = urgentAlerts.length + openIncidents.length;
  if (total === 0) return null;

  return (
    <div className={styles.bar}>
      <span className={styles.icon}>⚠</span>
      <span className={styles.message}>
        {urgentAlerts.length > 0 && (
          <>
            {urgentAlerts.length} urgent alert{urgentAlerts.length === 1 ? "" : "s"}
            {openIncidents.length > 0 ? " · " : ""}
          </>
        )}
        {openIncidents.length > 0 && <>{openIncidents.length} open incident{openIncidents.length === 1 ? "" : "s"}</>}
      </span>
      <span className={styles.links}>
        {urgentAlerts.length > 0 && (
          <Link href="/agent" className={styles.link}>
            View alerts →
          </Link>
        )}
        {openIncidents.length > 0 && (
          <Link href="/incidents" className={styles.link}>
            View incidents →
          </Link>
        )}
      </span>
      <button className={styles.dismiss} onClick={() => setDismissed(true)} aria-label="Dismiss">
        ✕
      </button>
    </div>
  );
}
