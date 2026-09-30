/**
 * Substantiates the README's claim that a European WINNER pick scores 1 for
 * reaching the semi-finals.
 *
 * If the winner slot only paid for winning and the final, 1 would be an
 * impossible score. It appears eight times, every one a genuine semi-finalist.
 * Re-run after changing the scoring rules to confirm the reading still holds:
 *
 *   npx tsx scripts/analyse-cups.ts
 */
import { readFileSync } from "node:fs";
import { mapRow, newMapperState } from "@/lib/import/slotMapping";

const wb = JSON.parse(readFileSync("scripts/workbook.json", "utf8"));
const EURO = new Set(["ucl", "europa-league", "conference-league"]);

const detail: string[] = [];
const winnerPoints = new Map<string, number>();
const sfPoints = new Map<string, number>();

for (const sheet of Object.keys(wb.seasons).sort()) {
  const state = newMapperState();
  for (const row of wb.seasons[sheet].rows) {
    const m = mapRow(row.label, state);
    if (!m || !EURO.has(m.competitionKey)) continue;
    for (const handle of wb.seasons[sheet].players) {
      const pick = row.picks[handle];
      if (!pick?.value) continue;
      const pts = Number(pick.points ?? 0);
      const bucket = m.kind === "CUP_WINNER" ? winnerPoints : m.kind === "CUP_SEMI_FINALIST" ? sfPoints : null;
      if (!bucket) continue;
      bucket.set(String(pts), (bucket.get(String(pts)) ?? 0) + 1);
      if (m.kind === "CUP_WINNER" && pts === 1) {
        detail.push(`  ${sheet} ${m.competitionKey.padEnd(18)} ${handle.padEnd(4)} ${pick.value}`);
      }
    }
  }
}

const show = (label: string, m: Map<string, number>) => {
  const entries = [...m.entries()].sort((a, b) => Number(a[0]) - Number(b[0]));
  console.log(`${label}: ` + entries.map(([p, n]) => `${p}pts x${n}`).join("  "));
};
show("European WINNER slot   ", winnerPoints);
show("European SEMIFINAL slot", sfPoints);
console.log("\nWinner-slot picks that scored exactly 1:");
for (const d of detail) console.log(d);
