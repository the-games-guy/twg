"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { MIN_PASSWORD_LENGTH, hashPassword } from "@/lib/password";
import { prisma } from "@/lib/db";
import { syncActiveSeason } from "@/lib/results/sync";
import type { CupStagePayload } from "@/lib/scoring/types";

export interface AdminState { ok: boolean; message: string }

export async function setDeadlineAction(_p: AdminState, formData: FormData): Promise<AdminState> {
  await requireAdmin();
  const seasonId = String(formData.get("seasonId"));
  const raw = String(formData.get("deadline") ?? "").trim();

  await prisma.season.update({
    where: { id: seasonId },
    data: { predictionDeadline: raw ? new Date(raw) : null },
  });
  revalidatePath("/admin");
  revalidatePath("/predictions");
  return {
    ok: true,
    message: raw ? "Deadline set. Predictions lock at that moment." : "Deadline cleared.",
  };
}

export async function setChangeWindowAction(_p: AdminState, formData: FormData): Promise<AdminState> {
  await requireAdmin();
  const seasonId = String(formData.get("seasonId"));
  const start = String(formData.get("start") ?? "").trim();
  const end = String(formData.get("end") ?? "").trim();
  const budget = Number(formData.get("budget") ?? 3);

  await prisma.season.update({
    where: { id: seasonId },
    data: {
      changeWindowStart: start ? new Date(start) : null,
      changeWindowEnd: end ? new Date(end) : null,
      changeBudget: Number.isFinite(budget) ? budget : 3,
    },
  });
  revalidatePath("/admin");
  return { ok: true, message: "Change window updated." };
}

/**
 * This IS the registration step: there is no self-serve signup, only the
 * admin recording which email identifies which player. That email is what
 * both sign-in routes check against — a matching Google account, or the
 * password set below.
 */
export async function setEmailAction(_p: AdminState, formData: FormData): Promise<AdminState> {
  await requireAdmin();
  const playerId = String(formData.get("playerId"));
  const raw = String(formData.get("email") ?? "").trim().toLowerCase();

  if (raw) {
    const existing = await prisma.player.findUnique({ where: { email: raw } });
    if (existing && existing.id !== playerId) {
      return { ok: false, message: `${raw} is already registered to ${existing.handle}.` };
    }
  }

  await prisma.player.update({
    where: { id: playerId },
    data: { email: raw || null },
  });
  // Existing sessions are untouched deliberately — changing the registered
  // email does not sign anyone out of a device already signed in.
  revalidatePath("/admin");
  return {
    ok: true,
    message: raw ? `Registered ${raw}.` : "Cleared — that player can no longer sign in at all.",
  };
}

/**
 * Issues or clears a password. Only meaningful once the player has an email
 * set — the password is a second way to prove control of that same identity,
 * not a separate account. Clearing it (leaving the field blank) leaves Google
 * as their only route in, if they have one registered.
 */
export async function setPasswordAction(_p: AdminState, formData: FormData): Promise<AdminState> {
  await requireAdmin();
  const playerId = String(formData.get("playerId"));
  const raw = String(formData.get("password") ?? "");

  const player = await prisma.player.findUnique({ where: { id: playerId } });
  if (!player) return { ok: false, message: "Unknown player." };

  if (!raw) {
    await prisma.player.update({
      where: { id: playerId },
      data: { passwordHash: null, failedLoginAttempts: 0, lockedUntil: null },
    });
    revalidatePath("/admin");
    return { ok: true, message: "Password cleared." };
  }

  if (!player.email) {
    return { ok: false, message: "Set their email first — a password on its own can't sign anyone in." };
  }
  if (raw.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` };
  }

  await prisma.player.update({
    where: { id: playerId },
    data: { passwordHash: hashPassword(raw), failedLoginAttempts: 0, lockedUntil: null },
  });
  revalidatePath("/admin");
  return { ok: true, message: `Password set. Share it with ${player.handle} yourself — it isn't shown again here.` };
}

export async function syncResultsAction(_p: AdminState): Promise<AdminState> {
  await requireAdmin();
  try {
    const report = await syncActiveSeason();
    if (!report) return { ok: false, message: "No active season." };

    const parts = [`Updated ${report.updated.length}`];
    if (report.skipped.length) parts.push(`${report.skipped.length} manual`);
    if (report.failed.length) {
      parts.push(`${report.failed.length} failed: ${report.failed.map((f) => `${f.competition} (${f.error})`).join("; ")}`);
    }
    revalidatePath("/leaderboard");
    revalidatePath("/admin");
    return { ok: report.failed.length === 0, message: parts.join(" · ") };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/** Cup results the free API tier does not cover, plus the Championship play-off. */
export async function saveManualResultAction(_p: AdminState, formData: FormData): Promise<AdminState> {
  await requireAdmin();
  const seasonCompetitionId = String(formData.get("seasonCompetitionId"));
  const kind = String(formData.get("kind"));

  if (kind === "PLAYOFF") {
    const winner = String(formData.get("playoffWinner") ?? "").trim();
    const existing = await prisma.actualResult.findUnique({
      where: { seasonCompetitionId_kind: { seasonCompetitionId, kind: "STANDINGS" } },
    });
    if (!existing) {
      return { ok: false, message: "Sync the league table first, then set the play-off winner." };
    }
    const payload = JSON.parse(existing.payload);
    payload.playoffWinner = winner || undefined;
    await prisma.actualResult.update({
      where: { id: existing.id },
      data: { payload: JSON.stringify(payload) },
    });
    revalidatePath("/admin/results");
    revalidatePath("/leaderboard");
    return { ok: true, message: winner ? `Play-off winner set to ${winner}.` : "Play-off winner cleared." };
  }

  const payload: CupStagePayload = {
    winner: String(formData.get("winner") ?? "").trim() || undefined,
    runnerUp: String(formData.get("runnerUp") ?? "").trim() || undefined,
    semiFinalists: [1, 2, 3, 4]
      .map((i) => String(formData.get(`sf${i}`) ?? "").trim())
      .filter(Boolean),
    eliminated: String(formData.get("eliminated") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  };
  const status = formData.get("final") === "on" ? "FINAL" : "PROVISIONAL";

  await prisma.actualResult.upsert({
    where: { seasonCompetitionId_kind: { seasonCompetitionId, kind: "CUP_STAGE" } },
    update: { payload: JSON.stringify(payload), status, source: "manual", fetchedAt: new Date() },
    create: {
      seasonCompetitionId,
      kind: "CUP_STAGE",
      payload: JSON.stringify(payload),
      status,
      source: "manual",
    },
  });
  revalidatePath("/admin/results");
  revalidatePath("/leaderboard");
  return { ok: true, message: `Saved (${status.toLowerCase()}).` };
}
