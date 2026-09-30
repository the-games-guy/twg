import { buildAliasIndex } from "@/lib/teams";
import type { CompetitionActuals } from "@/lib/scoring/types";

export const aliases = buildAliasIndex([
  { alias: "Man City", canonical: "Manchester City" },
  { alias: "Manchester City FC", canonical: "Manchester City" },
  { alias: "Spurs", canonical: "Tottenham Hotspur" },
  { alias: "Juve", canonical: "Juventus" },
  { alias: "Atletic Bilbao", canonical: "Athletic Bilbao" },
  { alias: "Bilbao", canonical: "Athletic Bilbao" },
  { alias: "Villareal", canonical: "Villarreal" },
  { alias: "Barca", canonical: "Barcelona" },
]);

/** Build a league table from an ordered list of club names. */
export function table(...teams: string[]) {
  return teams.map((team, i) => ({ position: i + 1, team }));
}

export function leagueActuals(
  teams: string[],
  opts: Partial<CompetitionActuals> & { playoffWinner?: string } = {},
): CompetitionActuals {
  const { playoffWinner, ...rest } = opts;
  return {
    status: "FINAL",
    standings: { table: table(...teams), playoffWinner },
    ...rest,
  };
}
