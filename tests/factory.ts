import { prisma } from "@/lib/db";
import { LEAGUE_RULESET_V1 } from "@/lib/scoring/ruleset";

export async function resetDb() {
  // Order matters: children before parents.
  await prisma.prediction.deleteMany();
  await prisma.predictionChange.deleteMany();
  await prisma.session.deleteMany();
  await prisma.slot.deleteMany();
  await prisma.teamAlias.deleteMany();
  await prisma.team.deleteMany();
  await prisma.actualResult.deleteMany();
  await prisma.seasonCompetition.deleteMany();
  await prisma.honour.deleteMany();
  await prisma.season.deleteMany();
  await prisma.competition.deleteMany();
  await prisma.ruleset.deleteMany();
  await prisma.player.deleteMany();
}

export interface Scenario {
  seasonId: string;
  players: Record<string, string>;
  slots: string[];
}

export async function buildScenario(opts: {
  predictionDeadline?: Date | null;
  changeWindowStart?: Date | null;
  changeWindowEnd?: Date | null;
  changeBudget?: number;
}): Promise<Scenario> {
  const ruleset = await prisma.ruleset.create({
    data: { key: "test-rules", name: "Test", config: JSON.stringify(LEAGUE_RULESET_V1) },
  });
  const season = await prisma.season.create({
    data: {
      label: "2026/27",
      startYear: 2026,
      rulesetId: ruleset.id,
      isActive: true,
      changeBudget: opts.changeBudget ?? 3,
      predictionDeadline: opts.predictionDeadline ?? null,
      changeWindowStart: opts.changeWindowStart ?? null,
      changeWindowEnd: opts.changeWindowEnd ?? null,
    },
  });
  const competition = await prisma.competition.create({
    data: { key: "premier-league", name: "Premier League", kind: "LEAGUE", providerCode: "PL" },
  });
  const sc = await prisma.seasonCompetition.create({
    data: { seasonId: season.id, competitionId: competition.id },
  });

  const slots: string[] = [];
  for (let i = 1; i <= 4; i++) {
    const slot = await prisma.slot.create({
      data: {
        seasonCompetitionId: sc.id,
        kind: "LEAGUE_POSITION",
        ordinal: i,
        label: `England - ${i}`,
        displayOrder: i,
      },
    });
    slots.push(slot.id);
  }

  const players: Record<string, string> = {};
  for (const handle of ["KV", "MC", "Tok"]) {
    const p = await prisma.player.create({ data: { handle, displayName: handle } });
    players[handle] = p.id;
  }

  return { seasonId: season.id, players, slots };
}

/** Attach a final league table so the leaderboard has something to score. */
export async function addStandings(seasonId: string, teams: string[]) {
  const sc = await prisma.seasonCompetition.findFirstOrThrow({ where: { seasonId } });
  await prisma.actualResult.upsert({
    where: { seasonCompetitionId_kind: { seasonCompetitionId: sc.id, kind: "STANDINGS" } },
    update: {},
    create: {
      seasonCompetitionId: sc.id,
      kind: "STANDINGS",
      status: "FINAL",
      source: "manual",
      payload: JSON.stringify({
        table: teams.map((team, i) => ({ position: i + 1, team })),
      }),
    },
  });
}
