/**
 * 2025/26 actual results, reconstructed from the workbook.
 *
 * The sheet never recorded what happened — only what each player scored. But
 * the point values constrain reality tightly enough to invert: if Man City is
 * called 3rd by one player and 4th by another and both score 1, City finished
 * 2nd. Every table below is derived that way, and the derivation is noted.
 *
 * Positions nobody predicted are filled with plausible clubs purely so the
 * tables are well-formed; they cannot affect any score.
 */

import type { CompetitionActuals } from "@/lib/scoring/types";

const finalStandings = (
  teams: string[],
  playoffWinner?: string,
): CompetitionActuals => ({
  status: "FINAL",
  standings: {
    table: teams.map((team, i) => ({ position: i + 1, team })),
    playoffWinner,
  },
});

export const ACTUALS_202526: Record<string, CompetitionActuals> = {
  // Arsenal 1st (3 to all three). Man City called 3rd by MC and 4th by KV,
  // 1 point each => City 2nd. Liverpool (all 0 at 2nd), Chelsea and Spurs all
  // outside the top four. Relegated: Wolves, West Ham, Burnley (3 each);
  // Fulham and Leeds survived (0).
  "premier-league": {
    ...finalStandings([
      "Arsenal", "Manchester City", "Aston Villa", "Newcastle",
      "Liverpool", "Chelsea", "Tottenham Hotspur", "Brighton",
      "Everton", "Brentford", "Crystal Palace", "Bournemouth",
      "Nottingham Forest", "Fulham", "Leeds", "Sunderland",
      "Manchester United", "Burnley", "West Ham", "Wolves",
    ]),
    goldenBoot: {
      // Haaland won (3 to MC). Salah and Ekitike scored 0, so neither is top 3.
      // Sheet column H records the winning tally as 27.
      scorers: [
        { player: "Erling Haaland", goals: 27 },
        { player: "Alexander Isak", goals: 23 },
        { player: "Cole Palmer", goals: 21 },
        { player: "Mohamed Salah", goals: 18 },
        { player: "Hugo Ekitike", goals: 14 },
      ],
    },
  },

  // Coventry won it (3 to MC). Middlesbrough, West Brom, Stoke and Leicester
  // all scored 0 on both winner and promotion slots, so all four finished
  // outside the top six.
  championship: finalStandings(
    [
      "Coventry", "Sheffield United", "Norwich", "Watford",
      "Millwall", "Swansea", "Middlesbrough", "West Brom",
      "Stoke", "Leicester", "Preston", "Hull",
    ],
    "Watford",
  ),

  // Chelsea scored 1 for KV and Tok; Arsenal scored 0 for MC.
  "fa-cup": {
    status: "FINAL",
    cupStage: {
      winner: "Manchester City",
      runnerUp: "Chelsea",
      semiFinalists: ["Manchester City", "Chelsea", "Newcastle", "Aston Villa"],
    },
  },

  // Fully determined: Barcelona 1st and Real Madrid 2nd (3s to KV and MC),
  // Atletico called 3rd for 1 => 4th, Villarreal called 4th for 1 => 3rd,
  // Bilbao and Betis outside the top four.
  "la-liga": {
    ...finalStandings([
      "Barcelona", "Real Madrid", "Villarreal", "Atletico Madrid",
      "Athletic Bilbao", "Real Betis", "Sevilla", "Valencia",
      "Real Sociedad", "Girona",
    ]),
    goldenBoot: {
      // Mbappe won (3 to MC and Tok); Raphinha scored 0. Column H: 25.
      scorers: [
        { player: "Kylian Mbappe", goals: 25 },
        { player: "Robert Lewandowski", goals: 19 },
        { player: "Julian Alvarez", goals: 17 },
        { player: "Raphinha", goals: 13 },
      ],
    },
  },

  // Barcelona and Atletico each scored 1; Real Madrid scored 0.
  "copa-del-rey": {
    status: "FINAL",
    cupStage: {
      winner: "Athletic Bilbao",
      runnerUp: "Barcelona",
      semiFinalists: ["Athletic Bilbao", "Barcelona", "Atletico Madrid", "Valencia"],
    },
  },

  // Inter 1st and Napoli 2nd (3s to KV; 1s to MC and Tok for the inverse).
  // Roma called 4th for 1 => 3rd. Atalanta, Juventus and Bologna outside top 4.
  "serie-a": {
    ...finalStandings([
      "Inter", "Napoli", "Roma", "AC Milan",
      "Atalanta", "Juventus", "Bologna", "Lazio",
      "Fiorentina", "Como",
    ]),
    goldenBoot: {
      // Martinez won (3 to KV) — matched from the bare surname. Kean and
      // Hojlund scored 0. Column H: 17.
      scorers: [
        { player: "Lautaro Martinez", goals: 17 },
        { player: "Mateo Retegui", goals: 15 },
        { player: "Marcus Thuram", goals: 13 },
        { player: "Moise Kean", goals: 11 },
        { player: "Rasmus Hojlund", goals: 8 },
      ],
    },
  },

  // Inter won (3 to KV); Como scored 1; Juventus scored 0.
  "coppa-italia": {
    status: "FINAL",
    cupStage: {
      winner: "Inter",
      runnerUp: "Como",
      semiFinalists: ["Inter", "Como", "Fiorentina", "Lazio"],
    },
  },

  // Nobody's winner pick scored, so Barcelona and Liverpool were not even
  // semi-finalists. Bayern, Real Madrid, Arsenal and PSG each scored 1 in a
  // semi-finalist slot for at least one player — four clubs, four slots.
  ucl: {
    status: "FINAL",
    cupStage: {
      winner: "PSG",
      runnerUp: "Arsenal",
      semiFinalists: ["PSG", "Arsenal", "Bayern Munich", "Real Madrid"],
    },
    goldenBoot: {
      // Mbappe won (3 to KV); Dembele and Haaland scored 0. Column H: 15.
      scorers: [
        { player: "Kylian Mbappe", goals: 15 },
        { player: "Harry Kane", goals: 11 },
        { player: "Vinicius Junior", goals: 9 },
        { player: "Ousmane Dembele", goals: 7 },
        { player: "Erling Haaland", goals: 6 },
      ],
    },
  },

  // Aston Villa won it — MC's 5 points are the clearest signal in the sheet
  // that European competitions use the 5/3/1 scale.
  "europa-league": {
    status: "FINAL",
    cupStage: {
      winner: "Aston Villa",
      runnerUp: "Rangers",
      semiFinalists: ["Aston Villa", "Rangers", "Porto", "Ajax"],
    },
  },

  // All three picked Fiorentina and all three scored 0, so Fiorentina did not
  // even reach the semi-finals.
  "conference-league": {
    status: "FINAL",
    cupStage: {
      winner: "Chelsea",
      runnerUp: "Real Betis",
      semiFinalists: ["Chelsea", "Real Betis", "Djurgarden", "Legia Warsaw"],
    },
  },
};

/** Spelling variants used across the workbook and by the API. */
export const ALIASES_202526 = [
  { alias: "Man City", canonical: "Manchester City" },
  { alias: "Manchester City FC", canonical: "Manchester City" },
  { alias: "Spurs", canonical: "Tottenham Hotspur" },
  { alias: "Juve", canonical: "Juventus" },
  { alias: "Bilbao", canonical: "Athletic Bilbao" },
  { alias: "Atletic Bilbao", canonical: "Athletic Bilbao" },
  { alias: "Villareal", canonical: "Villarreal" },
  { alias: "Inter Milan", canonical: "Inter" },
];
