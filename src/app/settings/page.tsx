"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import styles from "./page.module.css";

interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: "OPERATOR" | "SUPERVISOR" | "WORKER";
  workerId?: string;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `Request to ${path} failed`);
  return data as T;
}

export default function SettingsPage() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api<{ user: SessionUser }>("/api/auth/me")
      .then((data) => setUser(data.user))
      .catch(() => setUser(null));
  }, []);

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    if (newPassword !== confirmPassword) {
      setError("New password and confirmation don't match.");
      return;
    }
    setSaving(true);
    try {
      await api("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setSuccess("Password updated.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <Link href="/" className={styles.backLink}>
          ← Dashboard
        </Link>
        <div className={styles.divider} />
        <h1>Settings</h1>
      </header>

      <div className={styles.body}>
        <div className={styles.panel}>
          <h2>Profile</h2>
          {user ? (
            <dl className={styles.profileList}>
              <div>
                <dt>Name</dt>
                <dd>{user.name}</dd>
              </div>
              <div>
                <dt>Email</dt>
                <dd>{user.email}</dd>
              </div>
              <div>
                <dt>Role</dt>
                <dd>{user.role}</dd>
              </div>
            </dl>
          ) : (
            <p className={styles.hint}>Loading…</p>
          )}
          <p className={styles.hint}>
            Name, email, and role are managed by an administrator and can&apos;t be changed here.
          </p>
        </div>

        <div className={styles.panel}>
          <h2>Change Password</h2>
          <form className={styles.form} onSubmit={changePassword}>
            <label className={styles.fieldLabel}>
              Current password
              <input
                type="password"
                className={styles.textInput}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
              />
            </label>
            <label className={styles.fieldLabel}>
              New password
              <input
                type="password"
                className={styles.textInput}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                minLength={8}
              />
            </label>
            <label className={styles.fieldLabel}>
              Confirm new password
              <input
                type="password"
                className={styles.textInput}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                minLength={8}
              />
            </label>
            {error && <p className={styles.errorText}>{error}</p>}
            {success && <p className={styles.successText}>{success}</p>}
            <button
              type="submit"
              className={styles.primaryButton}
              disabled={saving || !currentPassword || !newPassword || !confirmPassword}
            >
              {saving ? "Saving…" : "Update password"}
            </button>
          </form>
        </div>

        <div className={styles.panel}>
          <h2>Container Management Agent thresholds</h2>
          <p className={styles.hint}>
            Aging-task, congestion-hotspot, and SLA-warning thresholds live on the{" "}
            <Link href="/agent" className={styles.inlineLink}>
              Agent
            </Link>{" "}
            page, next to the monitor they configure.
          </p>
        </div>
      </div>
    </div>
  );
}
