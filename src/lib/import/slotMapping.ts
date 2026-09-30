/**
 * Translate a workbook row label into (competition, slot kind, ordinal).
 *
 * The sheet is written for humans, so meaning depends on position: a row simply
 * labelled "Golden Boot" belongs to whichever league block precedes it, and
 * "Semi Finalist" appears four times in a row under the UCL. The mapper walks
 * rows top to bottom carrying that context, the way a reader does.
 *
 * Cup rows deliberately do NOT change the context: in every season sheet the
 * "FA Cup Winner" row sits between England's relegation picks and England's
 * Golden Boot, and that Golden Boot is the league's, not the cup's.
 */

import type { SlotKind, ValueType } from "@/lib/scoring/types";

export interface MappedSlot {
  competitionKey: string;
  kind: SlotKind;
  ordinal: number;
  valueType: ValueType;
  label: string;
}

/** Country/competition prefixes that set the surrounding league context. */
const LEAGUE_CONTEXTS: { match: RegExp; key: string }[] = [
  // Longest first — "England Championship" must beat "England".
  { match: /^england championship/, key: "championship" },
  { match: /^england/, key: "premier-league" },
  { match: /^spain/, key: "la-liga" },
  { match: /^italy/, key: "serie-a" },
  { match: /^germany/, key: "bundesliga" },
  { match: /^france/, key: "ligue-1" },
  { match: /^portugal/, key: "primeira-liga" },
  { match: /^holland/, key: "eredivisie" },
  { match: /^australia|^minor premier/, key: "a-league" },
  { match: /^scottish/, key: "scottish-premiership" },
  { match: /^ucl/, key: "ucl" },
];

/** Standalone cup rows, which never change the league context. */
const CUP_ROWS: { match: RegExp; key: string }[] = [
  { match: /^fa cup/, key: "fa-cup" },
  { match: /^copa del rey/, key: "copa-del-rey" },
  { match: /^italian cup/, key: "coppa-italia" },
  { match: /^german cup/, key: "dfb-pokal" },
  { match: /^europa/, key: "europa-league" },
  { match: /^conference league/, key: "conference-league" },
];

const norm = (label: string) => label.toLowerCase().replace(/\s+/g, " ").trim();

export interface MapperState {
  leagueContext: string | null;
  /** Repeated labels (3× "England - Relegated", 4× "Semi Finalist") self-number. */
  counters: Map<string, number>;
}

export function newMapperState(): MapperState {
  return { leagueContext: null, counters: new Map() };
}

function nextOrdinal(state: MapperState, key: string): number {
  const n = (state.counters.get(key) ?? 0) + 1;
  state.counters.set(key, n);
  return n;
}

/**
 * Returns null for a row this mapper does not understand. Callers must surface
 * those rather than dropping them — an unmapped row is a competition silently
 * missing from an imported season.
 */
export function mapRow(rawLabel: string, state: MapperState): MappedSlot | null {
  const label = norm(rawLabel);

  for (const { match, key } of LEAGUE_CONTEXTS) {
    if (match.test(label)) {
      state.leagueContext = key;
      break;
    }
  }

  // --- Golden Boot rows attach to the current league context ---------------
  if (label === "golden boot #") {
    if (!state.leagueContext) return null;
    return {
      competitionKey: state.leagueContext,
      kind: "GOLDEN_BOOT_COUNT",
      ordinal: 1,
      valueType: "NUMBER",
      label: rawLabel,
    };
  }
  if (label === "golden boot") {
    if (!state.leagueContext) return null;
    return {
      competitionKey: state.leagueContext,
      kind: "GOLDEN_BOOT_PLAYER",
      ordinal: 1,
      valueType: "PLAYER",
      label: rawLabel,
    };
  }

  // --- Repeated UCL semi-finalist rows -------------------------------------
  if (label === "semi finalist") {
    const key = state.leagueContext ?? "ucl";
    return {
      competitionKey: key,
      kind: "CUP_SEMI_FINALIST",
      ordinal: nextOrdinal(state, `${key}:sf`),
      valueType: "TEAM",
      label: rawLabel,
    };
  }

  // --- Standalone cups ------------------------------------------------------
  for (const { match, key } of CUP_ROWS) {
    if (match.test(label)) {
      return {
        competitionKey: key,
        kind: "CUP_WINNER",
        ordinal: 1,
        valueType: "TEAM",
        label: rawLabel,
      };
    }
  }

  const league = state.leagueContext;
  if (!league) return null;

  // --- League rows ----------------------------------------------------------
  if (/relegated|- w\/s$/.test(label)) {
    return {
      competitionKey: league,
      kind: "RELEGATION",
      ordinal: nextOrdinal(state, `${league}:rel`),
      valueType: "TEAM",
      label: rawLabel,
    };
  }
  if (/promotion/.test(label)) {
    return {
      competitionKey: league,
      kind: "PROMOTION",
      ordinal: nextOrdinal(state, `${league}:promo`),
      valueType: "TEAM",
      label: rawLabel,
    };
  }
  if (/- winner$/.test(label) || /^ucl$/.test(label)) {
    // "UCL" alone (pre-2024 sheets) is the winner pick, not a league position.
    if (league === "ucl") {
      return {
        competitionKey: "ucl",
        kind: "CUP_WINNER",
        ordinal: 1,
        valueType: "TEAM",
        label: rawLabel,
      };
    }
    return {
      competitionKey: league,
      kind: "LEAGUE_POSITION",
      ordinal: 1,
      valueType: "TEAM",
      label: rawLabel,
    };
  }
  if (/- 2nd$/.test(label) || /- r\/u$/.test(label)) {
    return { competitionKey: league, kind: "LEAGUE_POSITION", ordinal: 2, valueType: "TEAM", label: rawLabel };
  }
  if (/- 3rd$/.test(label)) {
    return { competitionKey: league, kind: "LEAGUE_POSITION", ordinal: 3, valueType: "TEAM", label: rawLabel };
  }
  if (/- 4th$/.test(label)) {
    return { competitionKey: league, kind: "LEAGUE_POSITION", ordinal: 4, valueType: "TEAM", label: rawLabel };
  }
  // Bare country name ("England", "Spain") in the 2018/19-era sheets = winner.
  if (LEAGUE_CONTEXTS.some(({ match }) => match.test(label)) && !label.includes("-")) {
    return { competitionKey: league, kind: "LEAGUE_POSITION", ordinal: 1, valueType: "TEAM", label: rawLabel };
  }

  return null;
}
