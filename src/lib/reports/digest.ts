/**
 * Plain-text reports for Signal.
 *
 * Signal renders monospace unreliably across clients, so these avoid ASCII
 * tables and column alignment in favour of short lines that survive any font.
 */

import { prisma } from "@/lib/db";
import { buildActiveLeaderboard, type SeasonLeaderboard } from "./leaderboard";
import { getEntryProgress, toSeasonState } from "@/lib/predictions";
import { PredictionsHiddenError, getPlayerPredictions } from "@/lib/predictions";

const medal = (rank: number) => (rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : "  ");

export function formatLeaderboard(board: SeasonLeaderboard): string {
  const lines = [`📊 ${board.seasonLabel} — standings`, ""];

  for (const row of board.rows) {
    const undecided = row.pending > 0 ? ` · ${row.pending} undecided` : "";
    lines.push(`${medal(row.rank)} ${row.rank}. ${row.playerHandle} — ${row.total} pts${undecided}`);
  }

  // A tie at the top is the interesting case, so say it rather than leaving it
  // to be inferred from two identical numbers.
  const leaders = board.rows.filter((r) => r.rank === 1);
  lines.push("");
  lines.push(
    leaders.length > 1
      ? `Level at the top: ${leaders.map((l) => l.playerHandle).join(" and ")}.`
      : `${leaders[0]?.playerHandle} leads by ${
          leaders[0].total - (board.rows.find((r) => r.rank > 1)?.total ?? 0)
        }.`,
  );

  if (board.awaiting.length) {
    lines.push("", `Still to come: ${board.awaiting.join(", ")}.`);
  }
  return lines.join("\n");
}

export async function leaderboardReport(): Promise<string> {
  const board = await buildActiveLeaderboard();
  if (!board) return "No season is running.";
  if (!board.isLocked) {
    const season = await prisma.season.findFirstOrThrow({
      where: { isActive: true }, orderBy: { startYear: "desc" },
    });
    const progress = await getEntryProgress(season.id);
    const lines = [
      `⏳ ${season.label} — entry still open, so there is nothing to rank yet.`,
      "",
      ...progress.map((p) => `${p.handle}: ${p.entered}/${p.total} entered`),
    ];
    if (season.predictionDeadline) {
      lines.push("", `Closes ${season.predictionDeadline.toUTCString()}.`);
    }
    return lines.join("\n");
  }
  return formatLeaderboard(board);
}

/** One player's full scorecard, grouped by competition. */
export async function playerCardReport(handle: string): Promise<string> {
  const board = await buildActiveLeaderboard();
  if (!board) return "No season is running.";

  const row = board.rows.find(
    (r) => r.playerHandle.toLowerCase() === handle.toLowerCase(),
  );
  if (!row) {
    return `No player called "${handle}". Try: ${board.rows.map((r) => r.playerHandle).join(", ")}.`;
  }
  if (!board.isLocked) {
    return "Predictions are still hidden — they open up when entry closes.";
  }

  const lines = [`📋 ${row.playerHandle} — ${row.total} pts (${row.rank}${row.rank === 1 ? "st" : row.rank === 2 ? "nd" : row.rank === 3 ? "rd" : "th"})`, ""];

  let currentCompetition = "";
  for (const slot of row.slots) {
    if (slot.competitionName !== currentCompetition) {
      currentCompetition = slot.competitionName;
      lines.push(`— ${currentCompetition} —`);
    }
    const mark =
      slot.result.status === "HIT" ? "✅" :
      slot.result.status === "PARTIAL" ? "🟡" :
      slot.result.status === "PENDING" ? "⏳" :
      slot.result.status === "ACTIVE" ? "🔵" : "❌";
    lines.push(`${mark} ${slot.slotLabel}: ${slot.prediction ?? "—"} (${slot.result.points})`);
  }
  return lines.join("\n");
}

/** What someone predicted, subject to the same blindness rule as the web app. */
export async function predictionsReport(
  targetHandle: string,
  requestingPlayerId: string,
): Promise<string> {
  const season = await prisma.season.findFirst({
    where: { isActive: true }, orderBy: { startYear: "desc" },
  });
  if (!season) return "No season is running.";

  const target = await prisma.player.findUnique({ where: { handle: targetHandle } });
  if (!target) return `No player called "${targetHandle}".`;

  try {
    const picks = await getPlayerPredictions(season.id, target.id, requestingPlayerId);
    if (picks.size === 0) return `${target.handle} has not entered anything yet.`;

    const slots = await prisma.slot.findMany({
      where: { seasonCompetition: { seasonId: season.id } },
      include: { seasonCompetition: { include: { competition: true } } },
      orderBy: { displayOrder: "asc" },
    });

    const lines = [`📋 ${target.handle} — ${season.label} predictions`, ""];
    let currentCompetition = "";
    for (const slot of slots) {
      const value = picks.get(slot.id);
      if (!value) continue;
      const name = slot.seasonCompetition.competition.name;
      if (name !== currentCompetition) {
        currentCompetition = name;
        lines.push(`— ${name} —`);
      }
      lines.push(`${slot.label}: ${value}`);
    }
    return lines.join("\n");
  } catch (e) {
    if (e instanceof PredictionsHiddenError) {
      return (
        `🔒 Nobody's predictions are visible until entry closes` +
        (e.deadline ? ` on ${e.deadline.toUTCString()}.` : ".")
      );
    }
    throw e;
  }
}

export async function changesReport(playerId: string): Promise<string> {
  const season = await prisma.season.findFirst({
    where: { isActive: true }, orderBy: { startYear: "desc" },
  });
  if (!season) return "No season is running.";

  const state = toSeasonState(season);
  const changes = await prisma.predictionChange.findMany({
    where: { seasonId: season.id, playerId },
    orderBy: { createdAt: "asc" },
  });

  const lines = [
    `🔄 ${season.label} — ${changes.length} of ${season.changeBudget} changes used`,
  ];
  if (changes.length) {
    lines.push("");
    for (const c of changes) {
      lines.push(`${c.createdAt.toISOString().slice(0, 10)}: ${c.description}`);
    }
  }
  lines.push("");
  if (!state.isLocked) lines.push("Entry is still open, so edits are free.");
  else if (state.changeWindowOpen) lines.push("The change window is open now.");
  else if (season.changeWindowStart && season.changeWindowStart > new Date()) {
    lines.push(`The window opens ${season.changeWindowStart.toISOString().slice(0, 10)}.`);
  } else lines.push("The change window has closed for this season.");

  return lines.join("\n");
}

export async function honourBoardReport(): Promise<string> {
  const honours = await prisma.honour.findMany({ orderBy: { year: "asc" } });
  if (!honours.length) return "No history imported yet.";

  const tally = new Map<string, { seasons: number; tournaments: number }>();
  for (const h of honours) {
    const t = tally.get(h.winnerName) ?? { seasons: 0, tournaments: 0 };
    if (h.kind === "SEASON") t.seasons += 1;
    else t.tournaments += 1;
    tally.set(h.winnerName, t);
  }

  const ranked = [...tally.entries()].sort(
    (a, b) =>
      b[1].seasons + b[1].tournaments - (a[1].seasons + a[1].tournaments) ||
      b[1].seasons - a[1].seasons,
  );

  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

  const lines = ["🏆 Honour board — all time", ""];
  for (const [name, t] of ranked) {
    lines.push(
      `${name}: ${t.seasons + t.tournaments} ` +
        `(${plural(t.seasons, "season")}, ${plural(t.tournaments, "tournament")})`,
    );
  }

  const lastSeason = honours.filter((h) => h.kind === "SEASON").at(-1);
  if (lastSeason) lines.push("", `Reigning champion: ${lastSeason.winnerName} (${lastSeason.label}).`);
  return lines.join("\n");
}

export const HELP_TEXT = [
  "TWG Comp bot",
  "",
  "/leaderboard — current standings",
  "/me — your scorecard",
  "/card <player> — anyone's scorecard",
  "/picks <player> — their predictions (after entry closes)",
  "/changes — your mid-season change budget",
  "/honours — all-time honour board",
  "/help — this message",
  "",
  "Predictions are entered on the web app, never here — this is a group chat.",
].join("\n");
