/**
 * Rule implementations.
 *
 * Every rule is a pure function of (prediction, actuals, params). No database,
 * no clock, no competition names. That is what makes the whole engine testable
 * against the historical workbook.
 *
 * Scoring is EXCLUSIVE, not additive: an exact hit scores exactPoints and never
 * exactPoints + nearPoints. Verified against the 2025/26 sheet, where Arsenal
 * called as champions scores 3 rather than 4.
 */

import {
  type AliasIndex,
  resolveTeam,
  sameTeam,
  samePerson,
} from "@/lib/teams";
import type {
  CompetitionActuals,
  ExactPositionParams,
  KnockoutStageParams,
  ScoreResult,
  SetMembershipParams,
  SlotKind,
  TopScorerCountParams,
  TopScorerPlayerParams,
} from "./types";

export interface RuleContext {
  slotKind: SlotKind;
  /** Position for LEAGUE_POSITION; disambiguator for repeated slots. */
  ordinal: number;
  aliases: AliasIndex;
}

const pending = (what: string): ScoreResult => ({
  points: 0,
  status: "PENDING",
  explanation: `${what} not decided yet`,
});

const noPick: ScoreResult = {
  points: 0,
  status: "MISS",
  explanation: "No prediction entered",
};

const ordinalWord = (n: number): string =>
  ["", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th"][n] ?? `${n}th`;

function positionOf(
  actuals: CompetitionActuals,
  aliases: AliasIndex,
  team: string,
): number | null {
  const table = actuals.standings?.table;
  if (!table) return null;
  const row = table.find((r) => sameTeam(aliases, r.team, team));
  return row ? row.position : null;
}

// ---------------------------------------------------------------------------

export function scoreExactPosition(
  prediction: string,
  actuals: CompetitionActuals,
  params: ExactPositionParams,
  ctx: RuleContext,
): ScoreResult {
  if (!prediction) return noPick;
  if (!actuals.standings) return pending("League table");

  const target = ctx.ordinal;
  const actual = positionOf(actuals, ctx.aliases, prediction);
  const name = resolveTeam(ctx.aliases, prediction);

  if (actual === null) {
    return {
      points: 0,
      status: "MISS",
      explanation: `${name} is not in this league's table`,
      resolvedName: name,
    };
  }
  const isFinal = actuals.status === "FINAL";
  const verb = isFinal ? "finished" : "are currently";

  if (actual === target) {
    return {
      points: params.exactPoints,
      status: "HIT",
      explanation: `${name} ${verb} ${ordinalWord(actual)} exactly as predicted`,
      resolvedName: name,
    };
  }
  if (actual <= params.band) {
    return {
      points: params.nearPoints,
      status: "PARTIAL",
      explanation: `${name} ${verb} ${ordinalWord(actual)}, inside the top ${params.band} but not ${ordinalWord(target)}`,
      resolvedName: name,
    };
  }
  return {
    points: 0,
    status: "MISS",
    explanation: `${name} ${verb} ${ordinalWord(actual)}, outside the top ${params.band}`,
    resolvedName: name,
  };
}

// ---------------------------------------------------------------------------

/** The set of clubs that actually went down / came up. */
function derivedSet(
  actuals: CompetitionActuals,
  params: SetMembershipParams,
): string[] | null {
  const table = actuals.standings?.table;
  if (!table) return null;

  const ordered = [...table].sort((a, b) => a.position - b.position);
  const members =
    params.setSource === "BOTTOM"
      ? ordered.slice(-params.setSize).map((r) => r.team)
      : ordered.slice(0, params.setSize).map((r) => r.team);

  if (params.includePlayoffWinner && actuals.standings?.playoffWinner) {
    members.push(actuals.standings.playoffWinner);
  }
  return members;
}

export function scoreSetMembership(
  prediction: string,
  actuals: CompetitionActuals,
  params: SetMembershipParams,
  ctx: RuleContext,
): ScoreResult {
  if (!prediction) return noPick;

  const members = derivedSet(actuals, params);
  if (!members) return pending("League table");

  const name = resolveTeam(ctx.aliases, prediction);
  const label = params.setSource === "BOTTOM" ? "relegated" : "promoted";
  const isFinal = actuals.status === "FINAL";
  const verb = isFinal ? "finished" : "are currently";
  const wereVerb = isFinal ? "were" : "are currently";
  const wereNotVerb = isFinal ? "were not" : "are not currently";

  // A promotion set is incomplete until the play-off is played; saying "wrong"
  // before then would be a lie.
  if (
    params.includePlayoffWinner &&
    !actuals.standings?.playoffWinner &&
    actuals.status === "PROVISIONAL"
  ) {
    return pending("Play-off");
  }

  if (members.some((m) => sameTeam(ctx.aliases, m, prediction))) {
    return {
      points: params.inSetPoints,
      status: "HIT",
      explanation: `${name} ${wereVerb} ${label}`,
      resolvedName: name,
    };
  }

  if (params.nearMissBand && params.nearMissPoints) {
    const actual = positionOf(actuals, ctx.aliases, prediction);
    if (actual !== null && actual <= params.nearMissBand) {
      return {
        points: params.nearMissPoints,
        status: "PARTIAL",
        explanation: `${name} ${verb} ${ordinalWord(actual)} — inside the top ${params.nearMissBand} but not ${label}`,
        resolvedName: name,
      };
    }
  }

  const actual = positionOf(actuals, ctx.aliases, prediction);
  return {
    points: 0,
    status: "MISS",
    explanation: actual
      ? `${name} ${verb} ${ordinalWord(actual)} and ${wereNotVerb} ${label}`
      : `${name} ${wereNotVerb} ${label}`,
    resolvedName: name,
  };
}

// ---------------------------------------------------------------------------

type Stage = "WINNER" | "RUNNER_UP" | "SEMI_FINALIST" | "NONE";

function stageReached(
  actuals: CompetitionActuals,
  aliases: AliasIndex,
  team: string,
): Stage {
  const cup = actuals.cupStage;
  if (!cup) return "NONE";
  if (cup.winner && sameTeam(aliases, cup.winner, team)) return "WINNER";
  if (cup.runnerUp && sameTeam(aliases, cup.runnerUp, team)) return "RUNNER_UP";
  if (cup.semiFinalists.some((t) => sameTeam(aliases, t, team)))
    return "SEMI_FINALIST";
  return "NONE";
}

const active = (name: string): ScoreResult => ({
  points: 0,
  status: "ACTIVE",
  explanation: `${name} are still in it — have not reached the semi-finals yet`,
  resolvedName: name,
});

const eliminated = (name: string): ScoreResult => ({
  points: 0,
  status: "MISS",
  explanation: `${name} were eliminated before the semi-finals`,
  resolvedName: name,
});

export function scoreKnockoutStage(
  prediction: string,
  actuals: CompetitionActuals,
  params: KnockoutStageParams,
  ctx: RuleContext,
): ScoreResult {
  if (!prediction) return noPick;
  if (!actuals.cupStage) return pending("Cup");

  const cup = actuals.cupStage;
  const name = resolveTeam(ctx.aliases, prediction);
  const stage = stageReached(actuals, ctx.aliases, prediction);
  const isOut = (cup.eliminated ?? []).some((t) => sameTeam(ctx.aliases, t, prediction));

  // A semi-finalist slot asks only "did this club reach the last four?", so the
  // winner and runner-up both qualify — they were semi-finalists too.
  if (ctx.slotKind === "CUP_SEMI_FINALIST") {
    if (cup.semiFinalists.length === 0 && actuals.status === "PROVISIONAL") {
      // Known out already beats "not decided yet" — that's the whole point of
      // tracking eliminations separately from the semi-final draw.
      return isOut ? eliminated(name) : active(name);
    }
    if (stage !== "NONE") {
      return {
        points: params.semiFinalistPoints,
        status: "HIT",
        explanation: `${name} reached the semi-finals`,
        resolvedName: name,
      };
    }
    return {
      points: 0,
      status: "MISS",
      explanation: `${name} did not reach the semi-finals`,
      resolvedName: name,
    };
  }

  switch (stage) {
    case "WINNER":
      return {
        points: params.winnerPoints,
        status: "HIT",
        explanation: `${name} won it`,
        resolvedName: name,
      };
    case "RUNNER_UP":
      return {
        points: params.runnerUpPoints,
        status: "PARTIAL",
        explanation: `${name} lost the final`,
        resolvedName: name,
      };
    case "SEMI_FINALIST":
      return {
        points: params.semiFinalistPoints,
        status: "PARTIAL",
        explanation: `${name} reached the semi-finals`,
        resolvedName: name,
      };
    default:
      if (isOut) return eliminated(name);
      if (!cup.winner && actuals.status === "PROVISIONAL") {
        return active(name);
      }
      return {
        points: 0,
        status: "MISS",
        explanation: `${name} went out before the semi-finals`,
        resolvedName: name,
      };
  }
}

// ---------------------------------------------------------------------------

/**
 * DENSE ranking, by distinct goal tallies — the way football commentary
 * actually talks about a scoring chart, and the convention the sheet itself
 * was scored under. When three players tie for the lead, the next tier down
 * is "3rd", not "4th": the 2023/24 UCL chart had Kane/de Jong/Mbappe level on
 * 8, then Haaland/Vinicius/Griezmann level on 6, and match reports called the
 * second group "shared third place" — counting the number of BETTER TIERS,
 * not the number of individual players ahead. The sheet credited Haaland's
 * Golden Boot pick with the top-3 consolation point in exactly this
 * situation, which only holds under dense ranking (skip-rank would place him
 * 4th, outside a top-3 band).
 */
function goalRank(scorers: { goals: number }[], index: number): number {
  const goals = scorers[index].goals;
  const higherTiers = new Set(scorers.filter((s) => s.goals > goals).map((s) => s.goals));
  return higherTiers.size + 1;
}

export function scoreTopScorerPlayer(
  prediction: string,
  actuals: CompetitionActuals,
  params: TopScorerPlayerParams,
  _ctx: RuleContext,
): ScoreResult {
  if (!prediction) return noPick;
  const scorers = actuals.goldenBoot?.scorers;
  if (!scorers || scorers.length === 0) return pending("Golden Boot");

  const isFinal = actuals.status === "FINAL";
  const verb = isFinal ? "finished" : "is currently";

  const index = scorers.findIndex((s) => samePerson(s.player, prediction));
  if (index === -1) {
    return {
      points: 0,
      status: "MISS",
      explanation: isFinal
        ? `${prediction} did not finish in the top ${params.band} scorers`
        : `${prediction} is not currently in the top ${params.band} scorers`,
    };
  }

  // The scorer's own spelling in the payload is the canonical one — a pick
  // that matched via samePerson() (e.g. "Haaland") should read the same as
  // everyone else's matching pick (e.g. "Erling Haaland"), both in this
  // sentence and in the prediction cell it's shown next to.
  const name = scorers[index].player;
  const rank = goalRank(scorers, index);
  const goals = scorers[index].goals;

  if (rank === 1) {
    const sharedWith = scorers.filter((s) => s.goals === goals).length - 1;
    const suffix = sharedWith > 0 ? `, sharing it with ${sharedWith}` : "";
    return {
      points: params.exactPoints,
      status: "HIT",
      explanation: isFinal
        ? `${name} won the Golden Boot with ${goals}${suffix}`
        : `${name} currently leads the Golden Boot race with ${goals}${suffix}`,
      resolvedName: name,
    };
  }
  if (rank <= params.band) {
    return {
      points: params.nearPoints,
      status: "PARTIAL",
      explanation: `${name} ${verb} ${ordinalWord(rank)} on ${goals} — inside the top ${params.band}`,
      resolvedName: name,
    };
  }
  return {
    points: 0,
    status: "MISS",
    explanation: `${name} ${verb} ${ordinalWord(rank)} on ${goals} — outside the top ${params.band}`,
    resolvedName: name,
  };
}

export function scoreTopScorerCount(
  prediction: string,
  actuals: CompetitionActuals,
  params: TopScorerCountParams,
  _ctx: RuleContext,
): ScoreResult {
  if (!prediction) return noPick;
  const scorers = actuals.goldenBoot?.scorers;
  if (!scorers || scorers.length === 0) return pending("Golden Boot");

  const guess = Number(prediction);
  if (!Number.isFinite(guess)) {
    return {
      points: 0,
      status: "MISS",
      explanation: `"${prediction}" is not a number of goals`,
    };
  }

  const isFinal = actuals.status === "FINAL";
  const actualLabel = isFinal ? "actual" : "current leader";
  const actual = scorers[0].goals;
  const delta = Math.abs(actual - guess);

  if (delta === 0) {
    return {
      points: params.exactPoints,
      status: "HIT",
      explanation: isFinal
        ? `Called the Golden Boot tally exactly: ${actual}`
        : `Currently exactly on the tally of the Golden Boot leader: ${actual}`,
    };
  }
  if (delta <= params.tolerance) {
    return {
      points: params.nearPoints,
      status: "PARTIAL",
      explanation: `Predicted ${guess}, ${actualLabel} ${actual} — within ${params.tolerance}`,
    };
  }
  return {
    points: 0,
    status: "MISS",
    explanation: `Predicted ${guess}, ${actualLabel} ${actual} — outside ${params.tolerance}`,
  };
}
