/**
 * Scoring vocabulary.
 *
 * Rule behaviour is data, not code branches: a Ruleset row maps each slot kind
 * onto a rule type plus parameters, and a SeasonCompetition can override any of
 * those parameters. That is what lets the Premier League use a top-4 near-miss
 * band while the Championship uses top-6, and the UCL use 5/3/1 while the FA Cup
 * uses 3/1/1, without either being special-cased.
 */

export const SLOT_KINDS = [
  "LEAGUE_POSITION",
  "RELEGATION",
  "PROMOTION",
  "CUP_WINNER",
  "CUP_SEMI_FINALIST",
  "GOLDEN_BOOT_PLAYER",
  "GOLDEN_BOOT_COUNT",
] as const;
export type SlotKind = (typeof SLOT_KINDS)[number];

export type ValueType = "TEAM" | "PLAYER" | "NUMBER";

export const RULE_TYPES = [
  "EXACT_POSITION",
  "SET_MEMBERSHIP",
  "KNOCKOUT_STAGE",
  "TOP_SCORER_PLAYER",
  "TOP_SCORER_COUNT",
] as const;
export type RuleType = (typeof RULE_TYPES)[number];

/** 3 for calling the exact finishing spot, 1 for landing inside `band`, else 0. */
export interface ExactPositionParams {
  exactPoints: number;
  nearPoints: number;
  /** Positions 1..band count as a near miss. The sheet's "top 4" rule. */
  band: number;
}

/**
 * Order-insensitive membership of a derived set — relegation (bottom N) or
 * promotion (top N, optionally plus the play-off winner).
 */
export interface SetMembershipParams {
  inSetPoints: number;
  setSource: "TOP" | "BOTTOM";
  setSize: number;
  /** Promotion only: the play-off winner joins the set despite finishing 3rd-6th. */
  includePlayoffWinner?: boolean;
  /** Consolation band. Championship promotion picks score 1 for a top-6 finish. */
  nearMissPoints?: number;
  nearMissBand?: number;
}

/** Domestic cups score 3/1/1; UCL, Europa and Conference score 5/3/1. */
export interface KnockoutStageParams {
  winnerPoints: number;
  runnerUpPoints: number;
  semiFinalistPoints: number;
}

export interface TopScorerPlayerParams {
  exactPoints: number;
  nearPoints: number;
  /** Finishing inside the top `band` scorers earns nearPoints. */
  band: number;
}

export interface TopScorerCountParams {
  exactPoints: number;
  nearPoints: number;
  /** Goals either side that still earn nearPoints. 3 for leagues, 1 for tournaments. */
  tolerance: number;
}

export type RuleParams =
  | ExactPositionParams
  | SetMembershipParams
  | KnockoutStageParams
  | TopScorerPlayerParams
  | TopScorerCountParams;

export interface SlotRule<P extends RuleParams = RuleParams> {
  type: RuleType;
  params: P;
}

export type RulesetConfig = {
  [K in SlotKind]: SlotRule;
};

/** Partial overlay stored on SeasonCompetition.ruleOverrides. */
export type RulesetOverrides = {
  [K in SlotKind]?: { params?: Record<string, unknown> };
};

// ---------------------------------------------------------------------------
// What actually happened
// ---------------------------------------------------------------------------

export interface StandingsPayload {
  /** Ordered, position 1 first. Team names are canonical. */
  table: { position: number; team: string }[];
  /** Championship only; not derivable from the league table. */
  playoffWinner?: string;
}

export interface CupStagePayload {
  winner?: string;
  runnerUp?: string;
  /** All four, including the two finalists. */
  semiFinalists: string[];
  /**
   * Clubs already known to be out, in a round earlier than the semi-final.
   * Lets a CUP_WINNER/CUP_SEMI_FINALIST pick score its 0 the moment the club
   * is knocked out, instead of waiting for the whole competition to finish.
   */
  eliminated?: string[];
}

export interface GoldenBootPayload {
  /** Ordered by goals descending. */
  scorers: { player: string; goals: number }[];
}

export interface CompetitionActuals {
  standings?: StandingsPayload;
  cupStage?: CupStagePayload;
  goldenBoot?: GoldenBootPayload;
  /** FINAL once the competition is decided; PROVISIONAL mid-season. */
  status: "PROVISIONAL" | "FINAL";
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

/**
 * PENDING keeps a live leaderboard honest: a cup final that has not been played
 * is not the same as a wrong answer, and the digest says so.
 *
 * ACTIVE is the knockout-specific middle state: the picked club has not been
 * eliminated but also has not reached the stage the slot pays for yet, so it
 * is worth 0 like a MISS without looking like one — PENDING stays reserved for
 * "no data at all", ACTIVE for "still alive, nothing decided yet".
 */
export type ScoreStatus = "HIT" | "PARTIAL" | "MISS" | "PENDING" | "ACTIVE";

export interface ScoreResult {
  points: number;
  status: ScoreStatus;
  /** Human sentence, surfaced in the web UI and by the Signal bot. */
  explanation: string;
  /**
   * Canonical spelling of the picked team/player, when one is known — e.g.
   * "Manchester City" for a prediction typed as "Man City", or "Erling Haaland"
   * for one typed as "Haaland". Lets every display of a pick (prediction cell,
   * explanation sentence) agree regardless of how it was typed.
   */
  resolvedName?: string;
}
