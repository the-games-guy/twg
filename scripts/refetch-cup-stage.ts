/**
 * Re-fetch CUP_STAGE for specific (season, competition) pairs — used after
 * fixing the extra-time/penalties status bug in fetchCupStage(), to avoid
 * re-spending the full daily request budget re-fetching everything.
 *
 *   npx tsx scripts/refetch-cup-stage.ts "2022/23:europa-league" "2023/24:copa-del-rey" ...
 */
import { prisma, applyPragmas } from "@/lib/db";
import { COMPETITIONS } from "@/lib/competitions";
import { fetchCupStage } from "@/lib/results/apiFootball";

const SEASONS: Record<string, number> = { "2022/23": 2022, "2023/24": 2023, "2024/25": 2024 };
const apiIdByKey = new Map(COMPETITIONS.filter((c) => c.apiFootballId).map((c) => [c.key, c.apiFootballId!]));

async function main() {
  await applyPragmas();
  for (const arg of process.argv.slice(2)) {
    const [label, key] = arg.split(":");
    const season = await prisma.season.findUniqueOrThrow({ where: { label } });
    const competition = await prisma.competition.findUniqueOrThrow({ where: { key } });
    const sc = await prisma.seasonCompetition.findFirstOrThrow({
      where: { seasonId: season.id, competitionId: competition.id },
    });
    const leagueId = apiIdByKey.get(key)!;
    const payload = await fetchCupStage(leagueId, SEASONS[label]);
    await prisma.actualResult.update({
      where: { seasonCompetitionId_kind: { seasonCompetitionId: sc.id, kind: "CUP_STAGE" } },
      data: { payload: JSON.stringify(payload), fetchedAt: new Date() },
    });
    console.log(`${label} ${competition.name}: winner=${payload.winner ?? "STILL MISSING"} runnerUp=${payload.runnerUp}`);
    await new Promise((r) => setTimeout(r, 7500));
  }
}
main().then(() => prisma.$disconnect());
