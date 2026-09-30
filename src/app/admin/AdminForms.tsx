"use client";

import { useActionState } from "react";
import type { AdminState } from "./actions";

const INITIAL: AdminState = { ok: true, message: "" };

type Action = (prev: AdminState, formData: FormData) => Promise<AdminState>;

export function ActionForm({
  action,
  submitLabel,
  children,
  confirm,
}: {
  action: Action;
  submitLabel: string;
  children?: React.ReactNode;
  confirm?: string;
}) {
  const [state, dispatch, pending] = useActionState(action, INITIAL);
  return (
    <form
      action={dispatch}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {children}
      <div style={{ marginTop: "0.75rem", display: "flex", alignItems: "center", gap: "0.85rem", flexWrap: "wrap" }}>
        <button type="submit" disabled={pending}>
          {pending ? "Working…" : submitLabel}
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

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block", marginBottom: "0.6rem" }}>
      <span className="tiny muted" style={{ display: "block", marginBottom: "0.2rem" }}>{label}</span>
      {children}
      {hint && <span className="tiny muted" style={{ display: "block", marginTop: "0.2rem" }}>{hint}</span>}
    </label>
  );
}
