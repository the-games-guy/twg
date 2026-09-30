/**
 * API-Football (v3.football.api-sports.io) client.
 *
 * IMPORTANT: the free plan only serves seasons 2022-2024. It returns
 * `{"errors":{"plan":"Free plans do not have access to this season..."}}` for
 * anything newer, so this cannot run the live season — football-data.org does
 * that. What it can do is supply real, authoritative results for the imported
 * 2022/23, 2023/24 and 2024/25 seasons, which is what it is used for here.
 *
 * Paying for Pro ($19/mo) would let the same client run the live season and
 * cover the domestic cups that football-data.org's free tier omits; the shapes
 * below would not change.
 */

import type {
  CupStagePayload,
  GoldenBootPayload,
  StandingsPayload,
} from "@/lib/scoring/types";
import type { FetchedTeam } from "./footballData";

const BASE = "https://v3.football.api-sports.io";
/**
 * The free plan caps requests per MINUTE as well as per day. Exceeding the
 * per-minute ceiling returns 429 with an empty body, which is easy to mistake
 * for a data problem. ~8/min stays clear of it.
 */
const MIN_INTERVAL_MS = 7_500;
const MAX_RETRIES = 3;

let lastRequest = 0;
let queue: Promise<unknown> = Promise.resolve();

export class ApiFootballError extends Error {
  constructor(message: string, public readonly kind: "PLAN" | "AUTH" | "OTHER" = "OTHER") {
    super(message);
    this.name = "ApiFootballError";
  }
}

async function get<T>(path: string): Promise<T> {
  const key = process.env.API_FOOTBALL_KEY;
  if (!key) throw new ApiFootballError("API_FOOTBALL_KEY is not set", "AUTH");

  const run = queue.then(async () => {
    const wait = Math.max(0, lastRequest + MIN_INTERVAL_MS - Date.now());
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequest = Date.now();

    let res = await fetch(`${BASE}${path}`, {
      headers: { "x-apisports-key": key },
      cache: "no-store",
    });

    // Back off and retry on the per-minute limit rather than reporting it as a
    // failure — the request is fine, it just arrived too soon.
    for (let attempt = 1; attempt <= MAX_RETRIES && res.status === 429; attempt += 1) {
      await new Promise((r) => setTimeout(r, 20_000 * attempt));
      lastRequest = Date.now();
      res = await fetch(`${BASE}${path}`, {
        headers: { "x-apisports-key": key },
        cache: "no-store",
      });
    }

    if (!res.ok) throw new ApiFootballError(`${res.status} ${res.statusText} for ${path}`);

    const body = (await res.json()) as { errors?: unknown; response?: unknown };

    // Errors arrive as 200 with a populated `errors` field — an empty ARRAY
    // means success, an object means failure.
    const errors = body.errors;
    if (errors && !Array.isArray(errors) && Object.keys(errors).length > 0) {
      const e = errors as Record<string, string>;
      if (e.plan) throw new ApiFootballError(e.plan, "PLAN");
      if (e.token || e.requests) throw new ApiFootballError(String(e.token ?? e.requests), "AUTH");
      throw new ApiFootballError(JSON.stringify(errors));
    }
    return body as T;
  });
  queue = run.catch(() => undefined);
  return run;
}

interface ApiTeamRef { id: number; name: string; winner?: boolean | null }

export async function fetchStandings(
  leagueId: number,
  season: number,
): Promise<{ payload: StandingsPayload; teams: FetchedTeam[] }> {
  const body = await get<{
    response: { league: { standings: { rank: number; team: { id: number; name: string } }[][] } }[];
  }>(`/standings?league=${leagueId}&season=${season}`);

  const league = body.response[0]?.league;
  const table = league?.standings?.[0];
  if (!table?.length) throw new ApiFootballError(`No standings for league ${leagueId} ${season}`);

  return {
    payload: { table: table.map((r) => ({ position: r.rank, team: r.team.name })) },
    teams: table.map((r) => ({ providerId: r.team.id, name: r.team.name })),
  };
}

export async function fetchGoldenBoot(
  leagueId: number,
  season: number,
): Promise<GoldenBootPayload> {
  const body = await get<{
    response: {
      player: { name: string };
      statistics: { league?: { id: number }; goals: { total: number | null } }[];
    }[];
  }>(`/players/topscorers?league=${leagueId}&season=${season}`);

  return {
    scorers: body.response
      .map((p) => ({
        player: p.player.name,
        goals: leagueGoals(p.statistics, leagueId),
      }))
      .sort((a, b) => b.goals - a.goals),
  };
}

/**
 * Goals scored in one league, allowing for two quirks of the response.
 *
 * A player can have several statistics entries. API-Football duplicates a
 * player's record against their CURRENT club, so a single spell shows up twice
 * with identical totals — Sørloth's 2022/23 La Liga season appears as
 * "Real Sociedad 12" and "Atletico Madrid 12", and naively summing makes him
 * the Pichichi on 24 ahead of Lewandowski's real 23.
 *
 * A genuine mid-season transfer within the same league also produces multiple
 * entries, but with different totals, and those DO need adding together.
 *
 * Identical totals therefore mean duplication; differing totals mean a real
 * split. The API's own ordering reflects the true totals, so this reproduces it.
 */
export function leagueGoals(
  statistics: { league?: { id: number }; goals: { total: number | null } }[],
  leagueId: number,
): number {
  const entries = statistics
    .filter((st) => st.league?.id === leagueId)
    .map((st) => st.goals.total ?? 0);

  if (entries.length === 0) return 0;
  if (new Set(entries).size === 1) return entries[0];
  return entries.reduce((sum, g) => sum + g, 0);
}

const isSemi = (round: string) => /semi[- ]final/i.test(round);
const isFinal = (round: string) =>
  /final/i.test(round) && !/semi/i.test(round) && !/quarter/i.test(round);

/**
 * Finished-match status codes. A cup final decided after extra time or
 * penalties is still decided — "FT" alone missed every final that didn't end
 * in 90 minutes, which silently dropped the winner from cups that commonly go
 * to extra time (Copa del Rey 2024/25: Barcelona beat Real Madrid AET).
 */
const FINISHED_STATUSES = new Set(["FT", "AET", "PEN"]);

/**
 * Derive winner, runner-up and semi-finalists from the fixture list.
 *
 * Semi-finals are two-legged in Europe, so the four fixtures collapse to four
 * distinct clubs. The final's `winner` flag already accounts for extra time and
 * penalties; where it is null the tie is unfinished.
 */
export async function fetchCupStage(
  leagueId: number,
  season: number,
): Promise<CupStagePayload> {
  const body = await get<{
    response: {
      league: { round: string };
      fixture: { status: { short: string } };
      teams: { home: ApiTeamRef; away: ApiTeamRef };
    }[];
  }>(`/fixtures?league=${leagueId}&season=${season}`);

  const fixtures = body.response;

  const semiFinalists = [
    ...new Set(
      fixtures
        .filter((f) => isSemi(f.league.round))
        .flatMap((f) => [f.teams.home.name, f.teams.away.name]),
    ),
  ];

  let winner: string | undefined;
  let runnerUp: string | undefined;
  const final = fixtures.find(
    (f) => isFinal(f.league.round) && FINISHED_STATUSES.has(f.fixture.status.short),
  );
  if (final) {
    const { home, away } = final.teams;
    if (home.winner === true) { winner = home.name; runnerUp = away.name; }
    else if (away.winner === true) { winner = away.name; runnerUp = home.name; }
  }

  return { winner, runnerUp, semiFinalists };
}
