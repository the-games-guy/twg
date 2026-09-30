/**
 * Google redirects here with either (state, code) on success or (error) if
 * the user cancelled at Google's consent screen. Either way we end up back on
 * "/", which reads the outcome from a query param and renders it — there is
 * no separate "auth failed" page to keep in sync with this one.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createSession, setSessionCookie } from "@/lib/auth";
import { GoogleSignInError, completeGoogleSignIn } from "@/lib/googleAuth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const origin = request.nextUrl.origin;

  const oauthError = searchParams.get("error");
  if (oauthError) {
    return NextResponse.redirect(`${origin}/?error=cancelled`);
  }

  const state = searchParams.get("state");
  const code = searchParams.get("code");
  if (!state || !code) {
    return NextResponse.redirect(`${origin}/?error=bad_request`);
  }

  let email: string;
  try {
    email = await completeGoogleSignIn(state, code);
  } catch (e) {
    if (e instanceof GoogleSignInError) {
      console.error("Google sign-in failed:", e.reason, e.message);
      return NextResponse.redirect(`${origin}/?error=oauth`);
    }
    throw e;
  }

  const player = await prisma.player.findUnique({ where: { email } });
  if (!player) {
    // Deliberately not "invalid credentials" — the Google side succeeded.
    // This is specifically "you're not one of the three people this app is
    // for", which is worth saying plainly rather than looking like a bug.
    return NextResponse.redirect(`${origin}/?error=not_registered`);
  }

  const token = await createSession(player.id, request.headers.get("user-agent") ?? undefined);
  await setSessionCookie(token);
  return NextResponse.redirect(`${origin}/predictions`);
}
