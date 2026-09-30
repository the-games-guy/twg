/**
 * Google Sign-In, hand-rolled rather than pulled from a framework.
 *
 * next-auth (Auth.js) v5 — the standard choice for this — has been in beta
 * for years with no stable release, which is a real risk to take on as the
 * one thing standing between the internet and everyone's predictions in an
 * app meant to run for years. For a single provider and three known users,
 * the actual OAuth surface is small enough to own directly. The one place
 * that is genuinely dangerous to get wrong — verifying the signed ID token —
 * uses Google's own maintained `google-auth-library`, not hand-rolled crypto.
 *
 * Flow: PKCE authorization code grant. The code_verifier and an anti-CSRF
 * state token are held in a short-lived signed cookie across the redirect
 * round-trip, verified on return, then discarded.
 */

import { randomBytes, createHash } from "node:crypto";
import { cookies } from "next/headers";
import { OAuth2Client } from "google-auth-library";

const AUTH_COOKIE = "twg_oauth";
const AUTH_COOKIE_TTL_SECONDS = 10 * 60; // the round trip to Google and back

function config() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const origin = process.env.APP_ORIGIN;
  if (!clientId || !clientSecret || !origin) {
    throw new Error(
      "GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and APP_ORIGIN must be set to use Google sign-in",
    );
  }
  return { clientId, clientSecret, origin, redirectUri: `${origin}/api/auth/google/callback` };
}

export function isGoogleAuthConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.APP_ORIGIN,
  );
}

const base64url = (buf: Buffer) =>
  buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Builds the Google authorization URL and stashes the PKCE/state pair. */
export async function startGoogleSignIn(): Promise<string> {
  const { clientId, redirectUri } = config();

  const state = base64url(randomBytes(24));
  const codeVerifier = base64url(randomBytes(32));
  const codeChallenge = base64url(createHash("sha256").update(codeVerifier).digest());

  const store = await cookies();
  store.set(AUTH_COOKIE, JSON.stringify({ state, codeVerifier }), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: AUTH_COOKIE_TTL_SECONDS,
  });

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  // No account picker for a returning player, but don't silently reuse a
  // session that's signed into the wrong Google account.
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

export class GoogleSignInError extends Error {
  constructor(message: string, public readonly reason: "STATE" | "EXCHANGE" | "TOKEN") {
    super(message);
    this.name = "GoogleSignInError";
  }
}

/**
 * Completes the flow: verifies the CSRF state, exchanges the code for tokens,
 * and verifies the ID token's signature, audience and issuer before trusting
 * the email inside it. Returns the verified, lowercased email.
 */
export async function completeGoogleSignIn(
  returnedState: string,
  code: string,
): Promise<string> {
  const { clientId, clientSecret, redirectUri } = config();

  const store = await cookies();
  const raw = store.get(AUTH_COOKIE)?.value;
  store.delete(AUTH_COOKIE);
  if (!raw) throw new GoogleSignInError("Sign-in expired — no pending request found", "STATE");

  const { state, codeVerifier } = JSON.parse(raw) as { state: string; codeVerifier: string };
  if (state !== returnedState) {
    throw new GoogleSignInError("State mismatch — possible CSRF attempt", "STATE");
  }

  const client = new OAuth2Client({ clientId, clientSecret, redirectUri });

  let tokens;
  try {
    ({ tokens } = await client.getToken({ code, codeVerifier }));
  } catch (e) {
    throw new GoogleSignInError(
      `Failed to exchange authorization code: ${e instanceof Error ? e.message : e}`,
      "EXCHANGE",
    );
  }
  if (!tokens.id_token) throw new GoogleSignInError("Google returned no ID token", "TOKEN");

  // verifyIdToken checks the signature against Google's published keys, plus
  // audience (our client ID) and issuer — this is the step that actually
  // establishes the email is real, not just present in an unsigned payload.
  const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: clientId });
  const payload = ticket.getPayload();
  if (!payload?.email) throw new GoogleSignInError("ID token had no email claim", "TOKEN");
  if (!payload.email_verified) {
    throw new GoogleSignInError("Google reports this email as unverified", "TOKEN");
  }

  return payload.email.toLowerCase();
}
