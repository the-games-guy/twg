/**
 * Import the spreadsheet: the honour board, and every past season's predictions.
 *
 * Historical seasons are marked isImported. Their recorded winner is preserved
 * exactly as the honour board has it, even where re-scoring disagrees — the
 * results of past years are the group's to revise, not the importer's. See
 * tests/replay-202526.test.ts for the discrepancies this surfaces.
 *
 * Usage:
 *   python3 scripts/dump-workbook.py "TWG Comp.xlsx" > scripts/workbook.json
 *   npm run import:workbook
 */

import { readFileSync } from "node:fs";
import { prisma, applyPragmas } from "@/lib/db";
import { COMPETITIONS, EUROPEAN_CUP_KEYS } from "@/lib/competitions";
import { mapRow, newMapperState } from "@/lib/import/slotMapping";
import {
  CHAMPIONSHIP_OVERRIDES,
  EUROPEAN_CUP_OVERRIDES,
  LEAGUE_RULESET_V1,
} from "@/lib/scoring/ruleset";

interface SheetRow {
  label: string;
  actual: string | null;
  picks: Record<string, { value: string | null; points: string | null }>;
}
interface Workbook {
  seasons: Record<string, { players: string[]; rows: SheetRow[]; sheetTotals: Record<string, string> }>;
  honour: { season: string; seasonWinner: string | null; tournament: string | null; tournamentWinner: string | null }[];
  skipped: string[];
}

/** The honour board uses full names; the season sheets use handles. */
const HANDLE_BY_NAME: Record<string, string> = {
  "King Voj": "KV", KV: "KV", MC: "MC", Tok: "Tok",
};

/** "202526" -> "2025/26" */
function seasonLabel(sheet: string): string {
  return `${sheet.slice(0, 4)}/${sheet.slice(4)}`;
}

function overridesFor(key: string): string | null {
  if (EUROPEAN_CUP_KEYS.includes(key)) return JSON.stringify(EUROPEAN_CUP_OVERRIDES);
  if (key === "championship") return JSON.stringify(CHAMPIONSHIP_OVERRIDES);
  return null;
}

async function main() {
  await applyPragmas();
  const wb = JSON.parse(readFileSync("scripts/workbook.json", "utf8")) as Workbook;

  const players = await prisma.player.findMany();
  const playerByHandle = new Map(players.map((p) => [p.handle, p]));

  const ruleset = await prisma.ruleset.upsert({
    where: { key: "league-v1" },
    update: {},
    create: {
      key: "league-v1",
      name: "League scoring v1",
      config: JSON.stringify(LEAGUE_RULESET_V1),
    },
  });

  for (const c of COMPETITIONS) {
    await prisma.competition.upsert({
      where: { key: c.key },
      update: {},
      create: c,
    });
  }
  const competitions = await prisma.competition.findMany();
  const competitionByKey = new Map(competitions.map((c) => [c.key, c]));

  // --- Honour board ---------------------------------------------------------
  let honourCount = 0;
  for (const row of wb.honour) {
    const startYear = Number(row.season.slice(0, 4));

    if (row.seasonWinner) {
      const handle = HANDLE_BY_NAME[row.seasonWinner] ?? row.seasonWinner;
      await prisma.honour.upsert({
        where: { label: row.season },
        update: { winnerName: handle, winnerId: playerByHandle.get(handle)?.id ?? null },
        create: {
          label: row.season,
          kind: "SEASON",
          year: startYear,
          winnerName: handle,
          winnerId: playerByHandle.get(handle)?.id ?? null,
        },
      });
      honourCount += 1;
    }

    if (row.tournament && row.tournamentWinner) {
      const handle = HANDLE_BY_NAME[row.tournamentWinner] ?? row.tournamentWinner;
      await prisma.honour.upsert({
        where: { label: row.tournament },
        update: { winnerName: handle, winnerId: playerByHandle.get(handle)?.id ?? null },
        create: {
          label: row.tournament,
          kind: "TOURNAMENT",
          // Tournament labels are "2014 WC", "Euro 2024" — pull the year out.
          year: Number(row.tournament.match(/\d{4}/)?.[0] ?? startYear),
          winnerName: handle,
          winnerId: playerByHandle.get(handle)?.id ?? null,
        },
      });
      honourCount += 1;
    }
  }
  console.log(`honours: ${honourCount}`);

  // --- Past seasons ---------------------------------------------------------
  // 2026/27 is the live season and is created by the seed, not imported.
  const sheets = Object.keys(wb.seasons).filter((s) => s !== "202627").sort();

  for (const sheet of sheets) {
    const data = wb.seasons[sheet];
    const label = seasonLabel(sheet);

    const season = await prisma.season.upsert({
      where: { label },
      update: { isImported: true },
      create: {
        label,
        startYear: Number(sheet.slice(0, 4)),
        rulesetId: ruleset.id,
        isActive: false,
        isImported: true,
        // Past seasons are closed: a deadline in the past means locked, which
        // makes their predictions visible to everyone, as they should be.
        predictionDeadline: new Date(`${sheet.slice(0, 4)}-08-01T00:00:00Z`),
      },
    });

    const state = newMapperState();
    const seenCompetitions = new Map<string, string>();
    let displayOrder = 0;
    let predictionCount = 0;

    for (const row of data.rows) {
      const mapped = mapRow(row.label, state);
      if (!mapped) {
        console.warn(`  ${sheet}: skipping unmapped row "${row.label}"`);
        continue;
      }

      let scId = seenCompetitions.get(mapped.competitionKey);
      if (!scId) {
        const competition = competitionByKey.get(mapped.competitionKey);
        if (!competition) throw new Error(`Unknown competition ${mapped.competitionKey}`);
        const sc = await prisma.seasonCompetition.upsert({
          where: { seasonId_competitionId: { seasonId: season.id, competitionId: competition.id } },
          update: {},
          create: {
            seasonId: season.id,
            competitionId: competition.id,
            displayOrder: seenCompetitions.size,
            ruleOverrides: overridesFor(mapped.competitionKey),
          },
        });
        scId = sc.id;
        seenCompetitions.set(mapped.competitionKey, sc.id);
      }

      const slot = await prisma.slot.upsert({
        where: {
          seasonCompetitionId_kind_ordinal: {
            seasonCompetitionId: scId, kind: mapped.kind, ordinal: mapped.ordinal,
          },
        },
        update: { label: row.label, displayOrder, valueType: mapped.valueType },
        create: {
          seasonCompetitionId: scId,
          kind: mapped.kind,
          ordinal: mapped.ordinal,
          label: row.label,
          displayOrder,
          valueType: mapped.valueType,
        },
      });
      displayOrder += 1;

      for (const handle of data.players) {
        const player = playerByHandle.get(handle);
        const value = row.picks[handle]?.value;
        if (!player || !value) continue;

        const existing = await prisma.prediction.findFirst({
          where: { playerId: player.id, slotId: slot.id, supersededAt: null },
        });
        if (existing) {
          if (existing.value !== value) {
            await prisma.prediction.update({ where: { id: existing.id }, data: { value } });
          }
        } else {
          await prisma.prediction.create({
            data: { playerId: player.id, slotId: slot.id, value },
          });
        }
        predictionCount += 1;
      }
    }

    console.log(
      `${label}: ${seenCompetitions.size} competitions, ${displayOrder} slots, ${predictionCount} predictions`,
    );
  }

  if (wb.skipped.length) {
    console.log(
      `\nNot imported (tournament format, out of scope for v1): ${wb.skipped.join(", ")}`,
    );
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
