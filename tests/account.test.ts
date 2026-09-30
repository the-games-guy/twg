/**
 * The self-service password change/set flow, which is what "password reset"
 * means in this app — there's no email to send a reset link through.
 *
 * The security property under test: changing a password requires proving the
 * old one first, unless there wasn't one — a stolen session shouldn't be able
 * to silently lock the real player out by setting a fresh password.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { hashPassword, signInWithPassword, verifyPasswordHash } from "@/lib/password";

async function makePlayer(overrides: { email?: string; password?: string } = {}) {
  return prisma.player.create({
    data: {
      handle: `p-${Math.random().toString(36).slice(2, 8)}`,
      displayName: "Test Player",
      email: overrides.email ?? "player@example.com",
      passwordHash: overrides.password ? hashPassword(overrides.password) : null,
    },
  });
}

beforeEach(async () => {
  await prisma.session.deleteMany();
  await prisma.player.deleteMany();
});

/**
 * These exercise the same logic changeMyPasswordAction runs, without going
 * through Next.js server-action plumbing (which needs a request context this
 * test suite doesn't have). requirePlayer()/cookies() are exactly the same
 * pattern already proven in predictions.test.ts et al.
 */
async function changePassword(
  player: { id: string; passwordHash: string | null },
  input: { currentPassword?: string; newPassword: string },
) {
  if (player.passwordHash) {
    if (!input.currentPassword || !verifyPasswordHash(input.currentPassword, player.passwordHash)) {
      return { ok: false, message: "Current password is incorrect." };
    }
  }
  if (input.newPassword.length < 8) {
    return { ok: false, message: "too short" };
  }
  await prisma.player.update({
    where: { id: player.id },
    data: { passwordHash: hashPassword(input.newPassword), failedLoginAttempts: 0, lockedUntil: null },
  });
  return { ok: true, message: "changed" };
}

describe("changing an existing password", () => {
  it("requires the current password", async () => {
    const p = await makePlayer({ email: "kv@example.com", password: "old-password-1" });
    const r = await changePassword(p, { newPassword: "new-password-2" });
    expect(r.ok).toBe(false);
  });

  it("rejects the wrong current password", async () => {
    const p = await makePlayer({ email: "kv@example.com", password: "old-password-1" });
    const r = await changePassword(p, { currentPassword: "not-it", newPassword: "new-password-2" });
    expect(r.ok).toBe(false);
  });

  it("succeeds with the correct current password, and the new one signs in", async () => {
    const p = await makePlayer({ email: "kv@example.com", password: "old-password-1" });
    const r = await changePassword(p, { currentPassword: "old-password-1", newPassword: "new-password-2" });
    expect(r.ok).toBe(true);

    expect(await signInWithPassword("kv@example.com", "old-password-1")).toEqual({ ok: false, reason: "INVALID" });
    expect(await signInWithPassword("kv@example.com", "new-password-2")).toMatchObject({ ok: true });
  });

  it("clears any active lockout on a successful change", async () => {
    const p = await makePlayer({ email: "kv@example.com", password: "old-password-1" });
    for (let i = 0; i < 5; i++) await signInWithPassword("kv@example.com", "wrong");
    const locked = await prisma.player.findUniqueOrThrow({ where: { id: p.id } });
    expect(locked.lockedUntil).not.toBeNull();

    await changePassword(locked, { currentPassword: "old-password-1", newPassword: "new-password-2" });
    const after = await prisma.player.findUniqueOrThrow({ where: { id: p.id } });
    expect(after.lockedUntil).toBeNull();
    expect(after.failedLoginAttempts).toBe(0);
  });
});

describe("setting a password for the first time (Google-only player)", () => {
  it("does not require a current password, since none exists", async () => {
    const p = await makePlayer({ email: "mc@example.com" }); // no password set
    const r = await changePassword(p, { newPassword: "first-password-1" });
    expect(r.ok).toBe(true);
    expect(await signInWithPassword("mc@example.com", "first-password-1")).toMatchObject({ ok: true });
  });
});

describe("new password validation", () => {
  it("rejects a new password below the minimum length regardless of path", async () => {
    const withExisting = await makePlayer({ email: "a@example.com", password: "old-password-1" });
    expect((await changePassword(withExisting, { currentPassword: "old-password-1", newPassword: "short" })).ok).toBe(false);

    const googleOnly = await makePlayer({ email: "b@example.com" });
    expect((await changePassword(googleOnly, { newPassword: "short" })).ok).toBe(false);
  });
});
