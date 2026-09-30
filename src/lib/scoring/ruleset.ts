/**
 * The default league ruleset, and the merge that lets a single competition
 * deviate from it.
 *
 * These values are transcribed from the "Points:" block at the top of every
 * season sheet and verified against 2025/26 point-by-point. Changing scoring in
 * a future year means creating a NEW ruleset row — never editing this object,
 * which past seasons still resolve against.
 */

import type { RulesetConfig, RulesetOverrides, SlotKind, SlotRule } from "./types";

export const LEAGUE_RULESET_V1: RulesetConfig = {
  // "Predict Correct Table position" 3 · "Predict within top 4 (each team)" 1
  LEAGUE_POSITION: {
    type: "EXACT_POSITION",
    params: { exactPoints: 3, nearPoints: 1, band: 4 },
  },

  // "Predict in bottom 3 (each team)" 3. All-or-nothing, order irrelevant.
  RELEGATION: {
    type: "SET_MEMBERSHIP",
    params: { inSetPoints: 3, setSource: "BOTTOM", setSize: 3 },
  },

  // 3 per promoted club (both automatic spots plus the play-off winner). No
  // near-miss band in the base ruleset — PROMOTION only ever appears under the
  // Championship in the historical data, so its top-6 consolation lives in
  // CHAMPIONSHIP_OVERRIDES below, not here.
  PROMOTION: {
    type: "SET_MEMBERSHIP",
    params: { inSetPoints: 3, setSource: "TOP", setSize: 2, includePlayoffWinner: true },
  },

  // Domestic cups: "Cup Winner" 3 · "Cup R/U" 1 · "Cup Semi Finalist" 1.
  // European competitions override this to 5/3/1.
  CUP_WINNER: {
    type: "KNOCKOUT_STAGE",
    params: { winnerPoints: 3, runnerUpPoints: 1, semiFinalistPoints: 1 },
  },
  CUP_SEMI_FINALIST: {
    type: "KNOCKOUT_STAGE",
    params: { winnerPoints: 3, runnerUpPoints: 1, semiFinalistPoints: 1 },
  },

  // "Predict the Golden Boot" 3 · "...within the top 3" 1
  GOLDEN_BOOT_PLAYER: {
    type: "TOP_SCORER_PLAYER",
    params: { exactPoints: 3, nearPoints: 1, band: 3 },
  },

  // "Predict Golden Boot Exact #" 3 · "Predict Golden Boot + or - 3 goals" 1
  GOLDEN_BOOT_COUNT: {
    type: "TOP_SCORER_COUNT",
    params: { exactPoints: 3, nearPoints: 1, tolerance: 3 },
  },
};

/** "UCL and Europa winner: 5 / R/U: 3 / semi finalist: 1" */
export const EUROPEAN_CUP_OVERRIDES: RulesetOverrides = {
  CUP_WINNER: {
    params: { winnerPoints: 5, runnerUpPoints: 3, semiFinalistPoints: 1 },
  },
  CUP_SEMI_FINALIST: {
    params: { winnerPoints: 5, runnerUpPoints: 3, semiFinalistPoints: 1 },
  },
};

/**
 * The Championship's promotion places run to 6th (2 automatic + 4 play-off
 * spots), so its PROMOTION picks get a top-6 consolation.
 *
 * The winner (LEAGUE_POSITION) slot does NOT get this override. Checked
 * against history: it has paid a near-miss exactly twice (West Brom 2019/20,
 * 2nd; Brentford 2020/21, 3rd) and both fit inside the ordinary top-4 band —
 * there is no evidence the winner slot's consolation ever reached 5th or 6th.
 * An earlier version of this file applied band:6 here on an unconfirmed
 * assumption; it disagreed with the sheet on Norwich (6th, 2023/24) and
 * Sunderland (4th, 2024/25), both scored 0 by the group. Removed.
 */
export const CHAMPIONSHIP_OVERRIDES: RulesetOverrides = {
  PROMOTION: { params: { nearMissPoints: 1, nearMissBand: 6 } },
};

/** Tournament sheets used "+ or - 1 goals" rather than 3. */
export const TOURNAMENT_OVERRIDES: RulesetOverrides = {
  GOLDEN_BOOT_COUNT: { params: { tolerance: 1 } },
};

/** Shallow param merge — overrides replace individual numbers, not whole rules. */
export function resolveRule(
  config: RulesetConfig,
  overrides: RulesetOverrides | null | undefined,
  kind: SlotKind,
): SlotRule {
  const base = config[kind];
  const override = overrides?.[kind];
  if (!override?.params) return base;
  return {
    type: base.type,
    params: { ...base.params, ...override.params } as SlotRule["params"],
  };
}

export function parseConfig(json: string): RulesetConfig {
  return JSON.parse(json) as RulesetConfig;
}

export function parseOverrides(json: string | null): RulesetOverrides | null {
  return json ? (JSON.parse(json) as RulesetOverrides) : null;
}
