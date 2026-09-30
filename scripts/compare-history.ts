/**
 * Re-score imported seasons against real results and compare with the points
 * the spreadsheet awarded.
 *
 * Where they disagree, one of two things is true: the sheet was mis-scored by
 * hand, or the engine has a rule wrong. Both are worth knowing, and neither is
 * visible from the spreadsheet alone.
 *
 * Requires: npx tsx scripts/backfill-historical.ts
 */

import { readFileSync } from "node:fs";
import { prisma } from "@/lib/db";
import { buildLeaderboard } from "@/lib/reports/leaderboard";
import { mapRow, newMapperState } from "@/lib/import/slotMapping";

interface SheetSeason {
  players: string[];
  rows: { label: string; picks: Record<string, { value: string | null; points: string | null }> }[];
  sheetTotals: Record<string, string>;
}

const workbook = JSON.parse(readFileSync("scripts/workbook.json", "utf8")) as {
  seasons: Record<string, SheetSeason>;
};

/** "2022/23" -> the workbook's sheet name "202223". */
const sheetKey = (label: string) => label.replace("/", "");

async function main() {
  const labels = process.argv.slice(2);
  const seasons = await prisma.season.findMany({
    where: labels.length ? { label: { in: labels } } : { isImported: true },
    orderBy: { startYear: "asc" },
  });

  for (const season of seasons) {
    const sheetName = sheetKey(season.label);
    const sheet = workbook.seasons[sheetName];
    if (!sheet) continue;

    const board = await buildLeaderboard(season.id);

    // Sheet points keyed the same way the importer keyed slots.
    const state = newMapperState();
    const sheetPoints = new Map<string, number>();
    const sheetValues = new Map<string, string>();
    for (const row of sheet.rows) {
      const m = mapRow(row.label, state);
      if (!m) continue;
      for (const handle of sheet.players) {
        const pick = row.picks[handle];
        if (!pick?.value) continue;
        const key = `${handle}|${m.competitionKey}|${m.kind}|${m.ordinal}`;
        sheetPoints.set(key, Number(pick.points ?? 0));
        sheetValues.set(key, pick.value);
      }
    }

    // Engine points, keyed identically.
    const slots = await prisma.slot.findMany({
      where: { seasonCompetition: { seasonId: season.id } },
      include: { seasonCompetition: { include: { competition: true } } },
    });
    const slotKey = new Map(
      slots.map((s) => [
        s.id,
        `${s.seasonCompetition.competition.key}|${s.kind}|${s.ordinal}`,
      ]),
    );

    const diffs: string[] = [];
    let compared = 0;
    let pending = 0;

    for (const row of board.rows) {
      for (const slot of row.slots) {
        const key = `${row.playerHandle}|${slotKey.get(slot.slotId)}`;
        if (!sheetPoints.has(key)) continue;
        if (slot.result.status === "PENDING") { pending += 1; continue; }
        compared += 1;
        const sheetPts = sheetPoints.get(key)!;
        if (sheetPts !== slot.result.points) {
          diffs.push(
            `    ${row.playerHandle.padEnd(4)} ${slot.competitionName} / ${slot.slotLabel}: ` +
              `"${slot.prediction}" sheet=${sheetPts} engine=${slot.result.points}` +
              `\n         ${slot.result.explanation}`,
          );
        }
      }
    }

    console.log(`\n=== ${season.label} ===`);
    const totals = board.rows
      .map((r) => `${r.playerHandle} ${r.total}`)
      .join(" · ");
    const sheetTotals = sheet.players
      .map((h) => `${h} ${sheet.sheetTotals[h] ?? "?"}`)
      .join(" · ");
    console.log(`  sheet totals : ${sheetTotals}`);
    console.log(`  engine (compared cells only, ${compared} scored, ${pending} unresolved)`);
    console.log(`  engine totals: ${totals}   <- includes unresolved competitions`);
    if (board.awaiting.length) console.log(`  no results for: ${board.awaiting.join(", ")}`);
    console.log(`  disagreements: ${diffs.length}`);
    for (const d of diffs) console.log(d);
  }
}

main().then(() => prisma.$disconnect()).catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
