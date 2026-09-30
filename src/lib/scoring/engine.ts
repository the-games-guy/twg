/**
 * Dispatch and aggregation.
 *
 * scoreSlot() is the single place a slot kind turns into points. Everything
 * above it — leaderboards, digests, the Signal bot — consumes ScoredSlot rows
 * and never re-implements scoring.
 */

import type { AliasIndex } from "@/lib/teams";
import {
  scoreExactPosition,
  scoreKnockoutStage,
  scoreSetMembership,
  scoreTopScorerCount,
  scoreTopScorerPlayer,
  type RuleContext,
} from "./rules";
import { resolveRule } from "./ruleset";
import type {
  CompetitionActuals,
  ExactPositionParams,
  KnockoutStageParams,
  RulesetConfig,
  RulesetOverrides,
  ScoreResult,
  SetMembershipParams,
  SlotKind,
  TopScorerCountParams,
  TopScorerPlayerParams,
} from "./types";

export interface SlotInput {
  id: string;
  kind: SlotKind;
  ordinal: number;
  label: string;
}

export interface ScoredSlot {
  slotId: string;
  slotLabel: string;
  competitionName: string;
  prediction: string | null;
  /** Canonical spelling to show a human — falls back to the raw prediction when none is known. */
  displayPrediction: string | null;
  result: ScoreResult;
}

export function scoreSlot(
  slot: SlotInput,
  prediction: string | null,
  actuals: CompetitionActuals,
  config: RulesetConfig,
  overrides: RulesetOverrides | null,
  aliases: AliasIndex,
): ScoreResult {
  const rule = resolveRule(config, overrides, slot.kind);
  const ctx: RuleContext = {
    slotKind: slot.kind,
    ordinal: slot.ordinal,
    aliases,
  };
  const value = prediction ?? "";

  switch (rule.type) {
    case "EXACT_POSITION":
      return scoreExactPosition(value, actuals, rule.params as ExactPositionParams, ctx);
    case "SET_MEMBERSHIP":
      return scoreSetMembership(value, actuals, rule.params as SetMembershipParams, ctx);
    case "KNOCKOUT_STAGE":
      return scoreKnockoutStage(value, actuals, rule.params as KnockoutStageParams, ctx);
    case "TOP_SCORER_PLAYER":
      return scoreTopScorerPlayer(value, actuals, rule.params as TopScorerPlayerParams, ctx);
    case "TOP_SCORER_COUNT":
      return scoreTopScorerCount(value, actuals, rule.params as TopScorerCountParams, ctx);
    default: {
      // Exhaustiveness guard: a new RuleType must be handled here.
      const never: never = rule.type;
      throw new Error(`Unhandled rule type: ${String(never)}`);
    }
  }
}

export interface CompetitionScoreInput {
  competitionName: string;
  slots: SlotInput[];
  actuals: CompetitionActuals;
  overrides: RulesetOverrides | null;
}

export interface PlayerScorecard {
  playerId: string;
  playerHandle: string;
  total: number;
  /** Points still in play — slots whose competition has not resolved. */
  pending: number;
  slots: ScoredSlot[];
}

export function scorePlayer(
  player: { id: string; handle: string },
  competitions: CompetitionScoreInput[],
  predictionsBySlot: Map<string, string>,
  config: RulesetConfig,
  aliases: AliasIndex,
): PlayerScorecard {
  const slots: ScoredSlot[] = [];
  let total = 0;
  let pending = 0;

  for (const comp of competitions) {
    for (const slot of comp.slots) {
      const prediction = predictionsBySlot.get(slot.id) ?? null;
      const result = scoreSlot(
        slot,
        prediction,
        comp.actuals,
        config,
        comp.overrides,
        aliases,
      );
      total += result.points;
      if (result.status === "PENDING" || result.status === "ACTIVE") pending += 1;
      slots.push({
        slotId: slot.id,
        slotLabel: slot.label,
        competitionName: comp.competitionName,
        prediction,
        displayPrediction: result.resolvedName ?? prediction,
        result,
      });
    }
  }

  return { playerId: player.id, playerHandle: player.handle, total, pending, slots };
}

export interface LeaderboardRow extends PlayerScorecard {
  rank: number;
}

/** Ties share a rank — three players on 44 are all 1st, and the next is 4th. */
export function rankScorecards(cards: PlayerScorecard[]): LeaderboardRow[] {
  const sorted = [...cards].sort((a, b) => b.total - a.total);
  const rows: LeaderboardRow[] = [];
  let lastTotal: number | null = null;
  let lastRank = 0;

  sorted.forEach((card, index) => {
    const rank = card.total === lastTotal ? lastRank : index + 1;
    lastTotal = card.total;
    lastRank = rank;
    rows.push({ ...card, rank });
  });

  return rows;
}
