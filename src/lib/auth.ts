/**
 * Sessions for a three-person league.
 *
 * Identity is established by Google Sign-In (see googleAuth.ts) — the actual
 * "registration" step is the admin recording each player's Google account
 * email against their Player row before that player's first sign-in, in the
 * admin screen. There is no self-serve signup and no password to manage.
 *
 * What lives here is unrelated to *how* someone proved who they are: a
 * signed, httpOnly session cookie backed by a database row, so a session can
 * be revoked (delete the row) without needing a JWT blocklist.
 */

import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { prisma } from "./db";

export const SESSION_COOKIE = "twg_session";
const SESSION_TTL_DAYS = 400;

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

export function generateToken(): string {
  return randomBytes(32).toString("hex");
}

export async function createSession(playerId: string, userAgent?: string): Promise<string> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  await prisma.session.create({
    data: { playerId, tokenHash: sha256(token), userAgent, expiresAt },
  });
  return token;
}

export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export interface CurrentPlayer {
  id: string;
  handle: string;
  displayName: string;
  isAdmin: boolean;
}

export async function getCurrentPlayer(): Promise<CurrentPlayer | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { player: true },
  });
  if (!session) return null;
  if (session.expiresAt < new Date()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }

  return {
    id: session.player.id,
    handle: session.player.handle,
    displayName: session.player.displayName,
    isAdmin: session.player.isAdmin,
  };
}

export async function requirePlayer(): Promise<CurrentPlayer> {
  const player = await getCurrentPlayer();
  if (!player) throw new Error("UNAUTHENTICATED");
  return player;
}

export async function requireAdmin(): Promise<CurrentPlayer> {
  const player = await requirePlayer();
  if (!player.isAdmin) throw new Error("FORBIDDEN");
  return player;
}
