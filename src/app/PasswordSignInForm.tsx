"use client";

import { useActionState } from "react";
import { passwordSignInAction, type PasswordSignInState } from "./actions";

const INITIAL: PasswordSignInState = { ok: true, message: "" };

export function PasswordSignInForm() {
  const [state, action, pending] = useActionState(passwordSignInAction, INITIAL);

  return (
    <form action={action}>
      <label className="tiny muted" htmlFor="email" style={{ display: "block", marginBottom: "0.2rem" }}>
        Email
      </label>
      <input id="email" name="email" type="email" autoComplete="email" required style={{ marginBottom: "0.6rem" }} />

      <label className="tiny muted" htmlFor="password" style={{ display: "block", marginBottom: "0.2rem" }}>
        Password
      </label>
      <input id="password" name="password" type="password" autoComplete="current-password" required />

      <div style={{ marginTop: "0.8rem", display: "flex", alignItems: "center", gap: "0.85rem", flexWrap: "wrap" }}>
        <button type="submit" disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </button>
        {state.message && (
          <span className="tiny" style={{ color: "var(--danger)" }}>{state.message}</span>
        )}
      </div>
    </form>
  );
}
