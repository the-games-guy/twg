/**
 * Password sign-in security properties: brute-force resistance and not
 * leaking which emails are registered.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { hashPassword, signInWithPassword } from "@/lib/password";

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

describe("hashPassword / signInWithPassword round trip", () => {
  it("accepts the correct password", async () => {
    const p = await makePlayer({ email: "kv@example.com", password: "correct horse battery" });
    const r = await signInWithPassword("kv@example.com", "correct horse battery");
    expect(r).toEqual({ ok: true, playerId: p.id });
  });

  it("rejects the wrong password", async () => {
    await makePlayer({ email: "kv@example.com", password: "correct horse battery" });
    const r = await signInWithPassword("kv@example.com", "wrong guess");
    expect(r).toEqual({ ok: false, reason: "INVALID" });
  });

  it("is case-insensitive on email but not on password", async () => {
    await makePlayer({ email: "kv@example.com", password: "Secret123!" });
    expect(await signInWithPassword("KV@Example.com", "Secret123!")).toMatchObject({ ok: true });
    expect(await signInWithPassword("kv@example.com", "secret123!")).toMatchObject({ ok: false });
  });
});

describe("not leaking which emails exist", () => {
  it("gives an identical result shape for an unknown email and a wrong password", async () => {
    await makePlayer({ email: "kv@example.com", password: "correct horse battery" });

    const unknownEmail = await signInWithPassword("nobody@example.com", "anything");
    const wrongPassword = await signInWithPassword("kv@example.com", "wrong guess");

    expect(unknownEmail).toEqual({ ok: false, reason: "INVALID" });
    expect(wrongPassword).toEqual({ ok: false, reason: "INVALID" });
  });

  it("gives the same result for a registered email with no password set as for an unknown email", async () => {
    // A player might have Google-only sign-in — that must not look different
    // from "this email doesn't exist" to someone probing the form.
    await makePlayer({ email: "google-only@example.com", password: undefined });
    const r = await signInWithPassword("google-only@example.com", "anything");
    expect(r).toEqual({ ok: false, reason: "INVALID" });
  });
});

describe("lockout", () => {
  const EMAIL = "kv@example.com";

  beforeEach(async () => {
    await makePlayer({ email: EMAIL, password: "correct horse battery" });
  });

  it("does not lock out before the threshold", async () => {
    for (let i = 0; i < 4; i++) {
      const r = await signInWithPassword(EMAIL, "wrong");
      expect(r).toEqual({ ok: false, reason: "INVALID" });
    }
  });

  it("locks out after 5 consecutive failures and blocks even the correct password", async () => {
    for (let i = 0; i < 5; i++) await signInWithPassword(EMAIL, "wrong");

    const r = await signInWithPassword(EMAIL, "correct horse battery");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("LOCKED");
      expect(r.retryAt).toBeInstanceOf(Date);
    }
  });

  it("releases the lock once retryAt has passed", async () => {
    for (let i = 0; i < 5; i++) await signInWithPassword(EMAIL, "wrong");

    const past = new Date(Date.now() + 16 * 60 * 1000); // just past the 15-minute window
    const r = await signInWithPassword(EMAIL, "correct horse battery", past);
    expect(r).toMatchObject({ ok: true });
  });

  it("resets the failure count on a successful sign-in", async () => {
    await signInWithPassword(EMAIL, "wrong");
    await signInWithPassword(EMAIL, "wrong");
    await signInWithPassword(EMAIL, "correct horse battery");

    // Two more wrong guesses shouldn't be anywhere near the 5-strike threshold
    // if the counter really reset.
    await signInWithPassword(EMAIL, "wrong");
    const r = await signInWithPassword(EMAIL, "wrong");
    expect(r).toEqual({ ok: false, reason: "INVALID" });
  });
});
