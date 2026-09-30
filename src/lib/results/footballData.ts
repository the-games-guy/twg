/**
 * football-data.org v4 client.
 *
 * Free tier: 10 requests/minute across Premier League, Championship, La Liga,
 * Serie A, Bundesliga, Ligue 1, Eredivisie, Primeira Liga and the Champions
 * League. No domestic cups, no Europa or Conference League — those competitions
 * carry providerCode: null and are entered by hand.
 *
 * The limiter is deliberately conservative and in-process: one worker performs
 * every sync, so a simple queue is sufficient and a 429 storm is not.
 */

import type {
  CupStagePayload,
  GoldenBootPayload,
  StandingsPayload,
} from "@/lib/scoring/types";

const BASE = "https://api.football-data.org/v4";
const MIN_INTERVAL_MS = 6_500; // ~9 req/min, just inside the 10/min ceiling

let lastRequest = 0;
let queue: Promise<unknown> = Promise.resolve();

export class FootballDataError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = "FootballDataError";
  }
}

/** Serialises requests and paces them under the rate limit. */
async function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = Math.max(0, lastRequest + MIN_INTERVAL_MS - Date.now());
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequest = Date.now();
    return fn();
  });
  // Keep the chain alive even when one call rejects.
  queue = run.catch(() => undefined);
  return run;
}

async function get<T>(path: string): Promise<T> {
  const key = process.env.FOOTBALL_DATA_API_KEY;
  if (!key) throw new FootballDataError("FOOTBALL_DATA_API_KEY is not set");

  return throttled(async () => {
    const res = await fetch(`${BASE}${path}`, {
      headers: { "X-Auth-Token": key },
      cache: "no-store",
    });
    if (res.status === 429) {
      throw new FootballDataError("Rate limited by football-data.org", 429);
    }
    if (res.status === 403) {
      throw new FootballDataError(
        `Competition not available on this plan (${path}). ` +
          `Set providerCode to null and enter results manually.`,
        403,
      );
    }
    if (!res.ok) {
      throw new FootballDataError(`${res.status} ${res.statusText} for ${path}`, res.status);
    }
    return (await res.json()) as T;
  });
}

// --- Response shapes (only the fields we use) --------------------------------

interface ApiTeam { id: number; name: string; shortName?: string; tla?: string }
interface StandingsResponse {
  standings: { stage: string; type: string; table: { position: number; team: ApiTeam }[] }[];
}
interface ScorersResponse {
  scorers: { player: { name: string }; goals: number | null }[];
}
interface MatchesResponse {
  matches: {
    stage: string;
    status: string;
    homeTeam: ApiTeam;
    awayTeam: ApiTeam;
    score: { winner: string | null };
  }[];
}

export interface FetchedTeam { providerId: number; name: string; shortName?: string; tla?: string }

export interface FetchedStandings {
  payload: StandingsPayload;
  teams: FetchedTeam[];
}

/** Overall league table for a season (the "TOTAL" table of the regular season). */
export async function fetchStandings(code: string, season: number): Promise<FetchedStandings> {
  const data = await get<StandingsResponse>(`/competitions/${code}/standings?season=${season}`);
  const total = data.standings.find((s) => s.type === "TOTAL" && s.stage === "REGULAR_SEASON")
    ?? data.standings.find((s) => s.type === "TOTAL");
  if (!total) throw new FootballDataError(`No TOTAL standings table for ${code} ${season}`);

  return {
    payload: {
      table: total.table.map((r) => ({ position: r.position, team: r.team.name })),
    },
    teams: total.table.map((r) => ({
      providerId: r.team.id,
      name: r.team.name,
      shortName: r.team.shortName,
      tla: r.team.tla,
    })),
  };
}

export async function fetchGoldenBoot(code: string, season: number): Promise<GoldenBootPayload> {
  const data = await get<ScorersResponse>(`/competitions/${code}/scorers?season=${season}&limit=10`);
  return {
    scorers: data.scorers
      .map((s) => ({ player: s.player.name, goals: s.goals ?? 0 }))
      .sort((a, b) => b.goals - a.goals),
  };
}

/**
 * Champions League knockout outcomes.
 *
 * Semi-finalists are the eight clubs appearing in semi-final ties, deduplicated
 * to four. The winner comes from the final's result rather than from any
 * standings table, which does not exist for a knockout competition.
 */
export async function fetchCupStage(code: string, season: number): Promise<CupStagePayload> {
  const data = await get<MatchesResponse>(`/competitions/${code}/matches?season=${season}`);

  const semis = data.matches.filter((m) => m.stage === "SEMI_FINALS");
  const semiFinalists = [
    ...new Set(semis.flatMap((m) => [m.homeTeam.name, m.awayTeam.name])),
  ].filter(Boolean);

  const final = data.matches.find((m) => m.stage === "FINAL" && m.status === "FINISHED");
  let winner: string | undefined;
  let runnerUp: string | undefined;
  if (final) {
    if (final.score.winner === "HOME_TEAM") {
      winner = final.homeTeam.name;
      runnerUp = final.awayTeam.name;
    } else if (final.score.winner === "AWAY_TEAM") {
      winner = final.awayTeam.name;
      runnerUp = final.homeTeam.name;
    }
  }

  return { winner, runnerUp, semiFinalists };
}

/** True once every match in the competition has been played. */
export async function isCompetitionFinished(code: string, season: number): Promise<boolean> {
  const data = await get<MatchesResponse>(`/competitions/${code}/matches?season=${season}`);
  return data.matches.length > 0 && data.matches.every((m) => m.status === "FINISHED");
}
