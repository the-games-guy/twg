/**
 * Email + password sign-in, as an alternative to Google for anyone who'd
 * rather not use it.
 *
 * A weaker credential than Google's — the password lives entirely in this
 * app rather than being backed by Google's own account security — but a
 * proportionate one for a private three-person group. scrypt makes each
 * guess deliberately expensive; the lockout below bounds how many guesses an
 * attacker gets at all.
 */

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { prisma } from "./db";

export const MIN_PASSWORD_LENGTH = 8;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64);
  return `${salt.toString("hex")}:${derived.toString("hex")}`;
}

export function verifyPasswordHash(password: string, stored: string): boolean {
  const [saltHex, expectedHex] = stored.split(":");
  if (!saltHex || !expectedHex) return false;
  const derived = scryptSync(password, Buffer.from(saltHex, "hex"), 64);
  const expected = Buffer.from(expectedHex, "hex");
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

const MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

export type PasswordSignInResult =
  | { ok: true; playerId: string }
  | { ok: false; reason: "INVALID" | "LOCKED"; retryAt?: Date };

/**
 * One error message for "no such email" and "wrong password" alike — an
 * attacker probing emails should not be able to tell which ones exist by
 * which message comes back. Only the lockout case gets a distinct message,
 * since by then they already know an attempt landed on a real account.
 */
export async function signInWithPassword(
  rawEmail: string,
  password: string,
  now = new Date(),
): Promise<PasswordSignInResult> {
  const email = rawEmail.trim().toLowerCase();
  const player = await prisma.player.findUnique({ where: { email } });

  // No such email, or no password set for them: still run a real scrypt hash
  // so the response time doesn't itself reveal which case this was.
  if (!player || !player.passwordHash) {
    hashPassword(password);
    return { ok: false, reason: "INVALID" };
  }

  if (player.lockedUntil && player.lockedUntil > now) {
    return { ok: false, reason: "LOCKED", retryAt: player.lockedUntil };
  }

  const valid = verifyPasswordHash(password, player.passwordHash);

  if (!valid) {
    const attempts = player.failedLoginAttempts + 1;
    const lockedUntil =
      attempts >= MAX_ATTEMPTS ? new Date(now.getTime() + LOCKOUT_MINUTES * 60 * 1000) : null;
    await prisma.player.update({
      where: { id: player.id },
      data: { failedLoginAttempts: attempts, lockedUntil },
    });
    return lockedUntil
      ? { ok: false, reason: "LOCKED", retryAt: lockedUntil }
      : { ok: false, reason: "INVALID" };
  }

  if (player.failedLoginAttempts > 0 || player.lockedUntil) {
    await prisma.player.update({
      where: { id: player.id },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    });
  }
  return { ok: true, playerId: player.id };
}
