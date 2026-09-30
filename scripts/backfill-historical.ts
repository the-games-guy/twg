/**
 * Fetch real results for the imported seasons API-Football's free plan allows
 * (2022/23, 2023/24, 2024/25) and store them as ActualResult rows.
 *
 * This turns three historical seasons from "predictions with hand-typed points"
 * into "predictions with authoritative results", so the engine can be checked
 * against reality rather than against the spreadsheet's own arithmetic.
 *
 *   npx tsx scripts/backfill-historical.ts
 *   npx tsx scripts/compare-history.ts
 */

import { prisma, applyPragmas } from "@/lib/db";
import { COMPETITIONS } from "@/lib/competitions";
import {
  ApiFootballError,
  fetchCupStage,
  fetchGoldenBoot,
  fetchStandings,
} from "@/lib/results/apiFootball";
import { normalise } from "@/lib/teams";

/** Season label -> API-Football season year. Free plan: 2022-2024 only. */
const SEASONS: Record<string, number> = {
  "2022/23": 2022,
  "2023/24": 2023,
  "2024/25": 2024,
};

const apiIdByKey = new Map(
  COMPETITIONS.filter((c) => c.apiFootballId).map((c) => [c.key, c.apiFootballId!]),
);

async function record(
  seasonCompetitionId: string,
  kind: "STANDINGS" | "CUP_STAGE" | "GOLDEN_BOOT",
  payload: unknown,
) {
  await prisma.actualResult.upsert({
    where: { seasonCompetitionId_kind: { seasonCompetitionId, kind } },
    update: { payload: JSON.stringify(payload), status: "FINAL", source: "api-football" },
    create: {
      seasonCompetitionId,
      kind,
      payload: JSON.stringify(payload),
      status: "FINAL",
      source: "api-football",
    },
  });
}

async function upsertTeams(teams: { providerId: number; name: string }[]) {
  for (const t of teams) {
    const team = await prisma.team.upsert({
      where: { name: t.name },
      update: {},
      create: { name: t.name },
    });
    const alias = normalise(t.name);
    if (!alias) continue;
    const existing = await prisma.teamAlias.findUnique({ where: { alias } });
    if (!existing) await prisma.teamAlias.create({ data: { alias, teamId: team.id } });
  }
}

async function main() {
  await applyPragmas();
  let requests = 0;

  for (const [label, year] of Object.entries(SEASONS)) {
    const season = await prisma.season.findUnique({
      where: { label },
      include: { competitions: { include: { competition: true, slots: true } } },
    });
    if (!season) {
      console.log(`${label}: not imported, skipping`);
      continue;
    }

    console.log(`\n=== ${label} (API season ${year}) ===`);

    for (const sc of season.competitions) {
      const key = sc.competition.key;
      const leagueId = apiIdByKey.get(key);
      if (!leagueId) {
        console.log(`  ${sc.competition.name}: no API-Football id, skipped`);
        continue;
      }

      const kinds = new Set(sc.slots.map((s) => s.kind));
      const wantsTable = kinds.has("LEAGUE_POSITION") || kinds.has("RELEGATION") || kinds.has("PROMOTION");
      const wantsBoot = kinds.has("GOLDEN_BOOT_PLAYER") || kinds.has("GOLDEN_BOOT_COUNT");
      const wantsCup = kinds.has("CUP_WINNER") || kinds.has("CUP_SEMI_FINALIST");

      const done: string[] = [];
      try {
        if (wantsTable) {
          const { payload, teams } = await fetchStandings(leagueId, year);
          requests += 1;
          await upsertTeams(teams);
          await record(sc.id, "STANDINGS", payload);
          done.push(`table(${payload.table.length})`);
        }
        if (wantsCup) {
          const payload = await fetchCupStage(leagueId, year);
          requests += 1;
          await record(sc.id, "CUP_STAGE", payload);
          done.push(`cup(${payload.winner ?? "?"}, ${payload.semiFinalists.length} SF)`);
        }
        if (wantsBoot) {
          const payload = await fetchGoldenBoot(leagueId, year);
          requests += 1;
          await record(sc.id, "GOLDEN_BOOT", payload);
          done.push(`boot(${payload.scorers[0]?.player ?? "?"} ${payload.scorers[0]?.goals ?? 0})`);
        }
        console.log(`  ${sc.competition.name}: ${done.join(" ") || "nothing needed"}`);
      } catch (e) {
        const msg = e instanceof ApiFootballError ? `${e.kind}: ${e.message}` : String(e);
        console.log(`  ${sc.competition.name}: FAILED ${msg}`);
        if (e instanceof ApiFootballError && e.kind === "AUTH") {
          console.log("\nStopping — daily request limit or bad key.");
          return;
        }
      }
    }
  }
  console.log(`\n${requests} API requests used`);
}

main().then(() => prisma.$disconnect()).catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
