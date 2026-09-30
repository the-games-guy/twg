/**
 * Load reconstructed results for imported seasons so past years can be
 * re-scored through the live engine rather than trusted from the sheet.
 *
 * Sourced from tests/fixtures — the derivation and its reasoning live there.
 */

import { prisma, applyPragmas } from "@/lib/db";
import { ACTUALS_202526, ALIASES_202526 } from "../tests/fixtures/actuals-202526";

async function main() {
  await applyPragmas();

  for (const { alias, canonical } of ALIASES_202526) {
    const team = await prisma.team.upsert({
      where: { name: canonical },
      update: {},
      create: { name: canonical },
    });
    await prisma.teamAlias.upsert({
      where: { alias: alias.toLowerCase() },
      update: { teamId: team.id },
      create: { alias: alias.toLowerCase(), teamId: team.id },
    });
  }

  const season = await prisma.season.findUnique({
    where: { label: "2025/26" },
    include: { competitions: { include: { competition: true } } },
  });
  if (!season) throw new Error("2025/26 not imported — run npm run import:workbook first");

  let written = 0;
  for (const sc of season.competitions) {
    const actuals = ACTUALS_202526[sc.competition.key];
    if (!actuals) continue;

    const rows: [string, unknown][] = [];
    if (actuals.standings) rows.push(["STANDINGS", actuals.standings]);
    if (actuals.cupStage) rows.push(["CUP_STAGE", actuals.cupStage]);
    if (actuals.goldenBoot) rows.push(["GOLDEN_BOOT", actuals.goldenBoot]);

    for (const [kind, payload] of rows) {
      await prisma.actualResult.upsert({
        where: { seasonCompetitionId_kind: { seasonCompetitionId: sc.id, kind } },
        update: { payload: JSON.stringify(payload), status: "FINAL", source: "import" },
        create: {
          seasonCompetitionId: sc.id,
          kind,
          payload: JSON.stringify(payload),
          status: "FINAL",
          source: "import",
        },
      });
      written += 1;
    }
  }
  console.log(`2025/26: wrote ${written} result rows`);
}

main().then(() => prisma.$disconnect()).catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
