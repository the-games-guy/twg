"use client";

import { useActionState } from "react";
import { changeMyPasswordAction, type ChangePasswordState } from "./actions";

const INITIAL: ChangePasswordState = { ok: true, message: "" };

export function ChangePasswordForm({ hasPassword }: { hasPassword: boolean }) {
  const [state, action, pending] = useActionState(changeMyPasswordAction, INITIAL);

  return (
    <form action={action}>
      {hasPassword && (
        <div style={{ marginBottom: "0.6rem" }}>
          <label className="tiny muted" htmlFor="currentPassword" style={{ display: "block", marginBottom: "0.2rem" }}>
            Current password
          </label>
          <input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" required />
        </div>
      )}

      <div style={{ marginBottom: "0.6rem" }}>
        <label className="tiny muted" htmlFor="newPassword" style={{ display: "block", marginBottom: "0.2rem" }}>
          {hasPassword ? "New password" : "Set a password"}
        </label>
        <input id="newPassword" name="newPassword" type="password" autoComplete="new-password" required />
      </div>

      <div style={{ marginBottom: "0.6rem" }}>
        <label className="tiny muted" htmlFor="confirmPassword" style={{ display: "block", marginBottom: "0.2rem" }}>
          Confirm password
        </label>
        <input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" required />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "0.85rem", flexWrap: "wrap" }}>
        <button type="submit" disabled={pending}>
          {pending ? "Saving…" : hasPassword ? "Change password" : "Set password"}
        </button>
        {state.message && (
          <span className="tiny" style={{ color: state.ok ? "var(--muted)" : "var(--danger)" }}>
            {state.message}
          </span>
        )}
      </div>
    </form>
  );
}
