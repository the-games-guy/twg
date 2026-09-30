/**
 * Historical replay.
 *
 * Feeds the real 2025/26 predictions through the engine against reconstructed
 * actuals and compares every cell to what the spreadsheet awarded.
 *
 * This test asserts that exactly three cells DISAGREE. That is deliberate: the
 * hand-scoring contains three errors, and an engine that reproduced the sheet
 * perfectly would have inherited them. If this test starts failing because the
 * diff set shrank, the engine has become bug-compatible with the spreadsheet.
 */

import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { scoreSlot } from "@/lib/scoring/engine";
import {
  CHAMPIONSHIP_OVERRIDES,
  EUROPEAN_CUP_OVERRIDES,
  LEAGUE_RULESET_V1,
} from "@/lib/scoring/ruleset";
import type { RulesetOverrides } from "@/lib/scoring/types";
import { mapRow, newMapperState } from "@/lib/import/slotMapping";
import { buildAliasIndex } from "@/lib/teams";
import { ACTUALS_202526, ALIASES_202526 } from "./fixtures/actuals-202526";

interface SheetRow {
  label: string;
  picks: Record<string, { value: string | null; points: string | null }>;
}

// The workbook holds real players' picks and is kept out of the public repo,
// so a fresh clone skips this suite rather than failing it.
const WORKBOOK_PATH = "scripts/workbook.json";
const hasWorkbook = existsSync(WORKBOOK_PATH);

const workbook = (hasWorkbook ? JSON.parse(readFileSync(WORKBOOK_PATH, "utf8")) : { seasons: {} }) as {
  seasons: Record<string, { players: string[]; rows: SheetRow[]; sheetTotals: Record<string, string> }>;
};

const season = workbook.seasons["202526"];
const aliases = buildAliasIndex(ALIASES_202526);

const EUROPEAN = new Set(["ucl", "europa-league", "conference-league"]);

function overridesFor(competitionKey: string): RulesetOverrides | null {
  if (EUROPEAN.has(competitionKey)) return EUROPEAN_CUP_OVERRIDES;
  if (competitionKey === "championship") return CHAMPIONSHIP_OVERRIDES;
  return null;
}

interface Cell {
  player: string;
  label: string;
  competitionKey: string;
  prediction: string | null;
  sheetPoints: number;
  enginePoints: number;
  explanation: string;
}

function replay(): Cell[] {
  const state = newMapperState();
  const cells: Cell[] = [];

  for (const row of season.rows) {
    const mapped = mapRow(row.label, state);
    if (!mapped) throw new Error(`Unmapped row: ${row.label}`);

    const actuals = ACTUALS_202526[mapped.competitionKey];
    if (!actuals) throw new Error(`No actuals for ${mapped.competitionKey}`);

    for (const player of season.players) {
      const pick = row.picks[player];
      const result = scoreSlot(
        { id: `${mapped.competitionKey}:${mapped.kind}:${mapped.ordinal}`, kind: mapped.kind, ordinal: mapped.ordinal, label: row.label },
        pick?.value ?? null,
        actuals,
        LEAGUE_RULESET_V1,
        overridesFor(mapped.competitionKey),
        aliases,
      );
      cells.push({
        player,
        label: row.label,
        competitionKey: mapped.competitionKey,
        prediction: pick?.value ?? null,
        sheetPoints: Number(pick?.points ?? 0),
        enginePoints: result.points,
        explanation: result.explanation,
      });
    }
  }
  return cells;
}

/** The three hand-scoring errors, established by inverting the sheet's own numbers. */
const KNOWN_SHEET_ERRORS = [
  {
    player: "Tok",
    label: "Spain - 2nd",
    prediction: "Barcelona",
    sheetPoints: 3,
    enginePoints: 1,
    why: "Barcelona finished 1st (it scored 3 as KV's and MC's winner pick), so calling it 2nd is a top-4 near miss worth 1, not an exact hit worth 3.",
  },
  {
    player: "Tok",
    label: "Semi Finalist",
    prediction: "Real Madrid",
    sheetPoints: 0,
    enginePoints: 1,
    why: "Real Madrid scored 1 in the same slot for both KV and MC. Tok's 0 is inconsistent with those two.",
  },
  {
    player: "MC",
    label: "Semi Finalist",
    prediction: "Barcelona",
    sheetPoints: 1,
    enginePoints: 0,
    why: "Barcelona scored 0 as KV's UCL winner pick, which under 5/3/1 means it was not a semi-finalist at all. Crediting it 1 here makes five clubs semi-finalists across four slots.",
  },
];

describe.skipIf(!hasWorkbook)("2025/26 replay against the spreadsheet", () => {
  const cells = hasWorkbook ? replay() : [];

  it("scores every cell in the sheet", () => {
    // 36 rows x 3 players
    expect(cells).toHaveLength(108);
  });

  it("leaves nothing PENDING — the season is complete", () => {
    const stillPending = cells.filter((c) => c.explanation.includes("not decided yet"));
    expect(stillPending).toEqual([]);
  });

  it("disagrees with the sheet on exactly the three known hand-scoring errors", () => {
    const diffs = cells.filter((c) => c.sheetPoints !== c.enginePoints);

    const summary = diffs.map((d) => ({
      player: d.player,
      label: d.label,
      prediction: d.prediction,
      sheetPoints: d.sheetPoints,
      enginePoints: d.enginePoints,
    }));

    expect(summary).toEqual(
      KNOWN_SHEET_ERRORS.map(({ player, label, prediction, sheetPoints, enginePoints }) => ({
        player, label, prediction, sheetPoints, enginePoints,
      })),
    );
  });

  it("agrees with the sheet on all 105 other cells", () => {
    const agreeing = cells.filter((c) => c.sheetPoints === c.enginePoints);
    expect(agreeing).toHaveLength(105);
  });

  it("produces season totals that differ from the sheet only by those errors", () => {
    const engineTotals: Record<string, number> = {};
    for (const c of cells) {
      engineTotals[c.player] = (engineTotals[c.player] ?? 0) + c.enginePoints;
    }

    // Sheet: KV 44, MC 45, Tok 28.
    // KV is untouched. MC loses 1 (Barcelona). Tok loses 2 and gains 1, net -1.
    expect(engineTotals).toEqual({ KV: 44, MC: 44, Tok: 27 });

    // Consequence worth stating plainly: MC's single erroneous point was the
    // whole margin of victory. Corrected, 2025/26 is a tie between MC and KV,
    // not the MC win the honour board records. This is a question for the
    // group, not something the importer should quietly overwrite — historical
    // seasons import with their recorded winner and isImported = true.
    const top = Math.max(...Object.values(engineTotals));
    const leaders = Object.entries(engineTotals)
      .filter(([, v]) => v === top)
      .map(([k]) => k)
      .sort();
    expect(leaders).toEqual(["KV", "MC"]);
  });
});
