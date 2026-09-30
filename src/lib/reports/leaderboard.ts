/**
 * Turns stored predictions and stored results into a leaderboard.
 *
 * This is the only place that assembles engine inputs from the database.
 * Everything that reports standings — the web page, the Signal digest, the bot's
 * /leaderboard command — goes through here so they can never disagree.
 */

import { prisma } from "@/lib/db";
import {
  rankScorecards,
  scorePlayer,
  type CompetitionScoreInput,
  type LeaderboardRow,
} from "@/lib/scoring/engine";
import { parseConfig, parseOverrides } from "@/lib/scoring/ruleset";
import type {
  CompetitionActuals,
  CupStagePayload,
  GoldenBootPayload,
  SlotKind,
  StandingsPayload,
} from "@/lib/scoring/types";
import { loadAliasIndex } from "@/lib/teamIndex";

export interface SeasonLeaderboard {
  seasonId: string;
  seasonLabel: string;
  isLocked: boolean;
  rows: LeaderboardRow[];
  /** Competitions with no results recorded at all, so readers know what is missing. */
  awaiting: string[];
  generatedAt: Date;
}

export async function buildLeaderboard(seasonId: string): Promise<SeasonLeaderboard> {
  const season = await prisma.season.findUniqueOrThrow({
    where: { id: seasonId },
    include: {
      ruleset: true,
      competitions: {
        include: { competition: true, slots: { orderBy: { displayOrder: "asc" } }, results: true },
        orderBy: { displayOrder: "asc" },
      },
    },
  });

  const config = parseConfig(season.ruleset.config);
  const aliases = await loadAliasIndex();

  const competitions: CompetitionScoreInput[] = [];
  const awaiting: string[] = [];

  for (const sc of season.competitions) {
    const actuals: CompetitionActuals = { status: "PROVISIONAL" };
    let anyFinal = false;
    let anyResult = false;

    for (const row of sc.results) {
      anyResult = true;
      if (row.status === "FINAL") anyFinal = true;
      const payload = JSON.parse(row.payload);
      if (row.kind === "STANDINGS") actuals.standings = payload as StandingsPayload;
      if (row.kind === "CUP_STAGE") actuals.cupStage = payload as CupStagePayload;
      if (row.kind === "GOLDEN_BOOT") actuals.goldenBoot = payload as GoldenBootPayload;
    }
    // A competition counts as FINAL only when every result row it has is final.
    actuals.status =
      anyFinal && sc.results.every((r) => r.status === "FINAL") ? "FINAL" : "PROVISIONAL";

    if (!anyResult) awaiting.push(sc.competition.name);

    competitions.push({
      competitionName: sc.competition.name,
      overrides: parseOverrides(sc.ruleOverrides),
      actuals,
      slots: sc.slots.map((s) => ({
        id: s.id,
        kind: s.kind as SlotKind,
        ordinal: s.ordinal,
        label: s.label,
      })),
    });
  }

  const players = await prisma.player.findMany({ orderBy: { handle: "asc" } });
  const predictions = await prisma.prediction.findMany({
    where: { supersededAt: null, slot: { seasonCompetition: { seasonId } } },
    select: { playerId: true, slotId: true, value: true },
  });

  const byPlayer = new Map<string, Map<string, string>>();
  for (const p of predictions) {
    let m = byPlayer.get(p.playerId);
    if (!m) byPlayer.set(p.playerId, (m = new Map()));
    m.set(p.slotId, p.value);
  }

  const cards = players.map((p) =>
    scorePlayer(
      { id: p.id, handle: p.handle },
      competitions,
      byPlayer.get(p.id) ?? new Map(),
      config,
      aliases,
    ),
  );

  return {
    seasonId: season.id,
    seasonLabel: season.label,
    isLocked: Boolean(season.predictionDeadline && season.predictionDeadline <= new Date()),
    rows: rankScorecards(cards),
    awaiting,
    generatedAt: new Date(),
  };
}

export async function buildActiveLeaderboard(): Promise<SeasonLeaderboard | null> {
  const season = await prisma.season.findFirst({
    where: { isActive: true },
    orderBy: { startYear: "desc" },
  });
  if (!season) return null;
  return buildLeaderboard(season.id);
}
