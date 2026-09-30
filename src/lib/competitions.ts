/**
 * Competition catalogue.
 *
 * providerCode is the football-data.org code. A null code means results for
 * that competition must be entered by hand — the free tier covers no domestic
 * cups and neither the Europa nor Conference League.
 */

export interface CompetitionSeed {
  key: string;
  name: string;
  country?: string;
  kind: "LEAGUE" | "CUP";
  /** football-data.org competition code. */
  providerCode: string | null;
  /**
   * API-Football league id. Only usable for seasons 2022-2024 on the free plan,
   * so this exists to backfill history, not to run the live season.
   */
  apiFootballId?: number;
}

export const COMPETITIONS: CompetitionSeed[] = [
  { key: "premier-league", name: "Premier League", country: "England", kind: "LEAGUE", providerCode: "PL" , apiFootballId: 39 },
  { key: "championship", name: "Championship", country: "England", kind: "LEAGUE", providerCode: "ELC" , apiFootballId: 40 },
  { key: "la-liga", name: "La Liga", country: "Spain", kind: "LEAGUE", providerCode: "PD" , apiFootballId: 140 },
  { key: "serie-a", name: "Serie A", country: "Italy", kind: "LEAGUE", providerCode: "SA" , apiFootballId: 135 },
  { key: "bundesliga", name: "Bundesliga", country: "Germany", kind: "LEAGUE", providerCode: "BL1" , apiFootballId: 78 },
  { key: "ligue-1", name: "Ligue 1", country: "France", kind: "LEAGUE", providerCode: "FL1" , apiFootballId: 61 },
  { key: "eredivisie", name: "Eredivisie", country: "Netherlands", kind: "LEAGUE", providerCode: "DED" , apiFootballId: 88 },
  { key: "primeira-liga", name: "Primeira Liga", country: "Portugal", kind: "LEAGUE", providerCode: "PPL" , apiFootballId: 94 },
  { key: "a-league", name: "A-League", country: "Australia", kind: "LEAGUE", providerCode: null , apiFootballId: 188 },
  { key: "scottish-premiership", name: "Scottish Premiership", country: "Scotland", kind: "LEAGUE", providerCode: null , apiFootballId: 179 },

  { key: "ucl", name: "Champions League", kind: "CUP", providerCode: "CL" , apiFootballId: 2 },

  // Manual entry — not on the free tier.
  { key: "fa-cup", name: "FA Cup", country: "England", kind: "CUP", providerCode: null , apiFootballId: 45 },
  { key: "copa-del-rey", name: "Copa del Rey", country: "Spain", kind: "CUP", providerCode: null , apiFootballId: 143 },
  { key: "coppa-italia", name: "Coppa Italia", country: "Italy", kind: "CUP", providerCode: null , apiFootballId: 137 },
  { key: "dfb-pokal", name: "DFB-Pokal", country: "Germany", kind: "CUP", providerCode: null , apiFootballId: 81 },
  { key: "europa-league", name: "Europa League", kind: "CUP", providerCode: null , apiFootballId: 3 },
  { key: "conference-league", name: "Conference League", kind: "CUP", providerCode: null , apiFootballId: 848 },
];

/** Competitions whose results cannot be fetched and must be admin-entered. */
export const MANUAL_COMPETITION_KEYS = COMPETITIONS.filter((c) => !c.providerCode).map((c) => c.key);

export const EUROPEAN_CUP_KEYS = ["ucl", "europa-league", "conference-league"];
