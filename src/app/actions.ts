"use server";

import { redirect } from "next/navigation";
import { createSession, setSessionCookie } from "@/lib/auth";
import { signInWithPassword } from "@/lib/password";

export interface PasswordSignInState {
  ok: boolean;
  message: string;
}

export async function passwordSignInAction(
  _prev: PasswordSignInState,
  formData: FormData,
): Promise<PasswordSignInState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { ok: false, message: "Enter both email and password." };
  }

  const result = await signInWithPassword(email, password);

  if (!result.ok) {
    if (result.reason === "LOCKED") {
      const mins = result.retryAt
        ? Math.max(1, Math.ceil((result.retryAt.getTime() - Date.now()) / 60_000))
        : null;
      return {
        ok: false,
        message: mins
          ? `Too many failed attempts. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`
          : "Too many failed attempts. Try again later.",
      };
    }
    // Deliberately identical wording to an unknown email — see signInWithPassword.
    return { ok: false, message: "Incorrect email or password." };
  }

  const token = await createSession(result.playerId);
  await setSessionCookie(token);
  redirect("/predictions");
}
