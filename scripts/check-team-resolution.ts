/**
 * For every TEAM-valued prediction in the three backfilled seasons (or the
 * season labels given as arguments, e.g. `2026/27`), check
 * whether it resolves to a club that actually appears somewhere in that
 * competition's stored results (table, cup stage). A name that resolves to
 * nothing silently scores 0/MISS regardless of what really happened — which a
 * disagreement-only diff can hide if the sheet also happened to award 0.
 */
import { prisma } from "@/lib/db";
import { loadAliasIndex } from "@/lib/teamIndex";
import { teamKey } from "@/lib/teams";
import type { CupStagePayload, StandingsPayload } from "@/lib/scoring/types";

async function main() {
  const aliases = await loadAliasIndex();
  const seasons = await prisma.season.findMany({
    where: { label: { in: process.argv.length > 2 ? process.argv.slice(2) : ["2022/23", "2023/24", "2024/25"] } },
    include: {
      competitions: {
        include: {
          competition: true,
          results: true,
          slots: { include: { predictions: { where: { supersededAt: null }, include: { player: true } } } },
        },
      },
    },
  });

  let checked = 0;
  const unresolved: string[] = [];

  for (const season of seasons) {
    for (const sc of season.competitions) {
      const knownClubs = new Set<string>();
      for (const r of sc.results) {
        const payload = JSON.parse(r.payload);
        if (r.kind === "STANDINGS") {
          for (const row of (payload as StandingsPayload).table) knownClubs.add(teamKey(aliases, row.team));
          if ((payload as StandingsPayload).playoffWinner) knownClubs.add(teamKey(aliases, (payload as StandingsPayload).playoffWinner!));
        }
        if (r.kind === "CUP_STAGE") {
          const cs = payload as CupStagePayload;
          if (cs.winner) knownClubs.add(teamKey(aliases, cs.winner));
          if (cs.runnerUp) knownClubs.add(teamKey(aliases, cs.runnerUp));
          for (const t of cs.semiFinalists) knownClubs.add(teamKey(aliases, t));
        }
      }
      if (knownClubs.size === 0) continue; // no results stored for this competition

      for (const slot of sc.slots) {
        if (slot.valueType !== "TEAM") continue;
        for (const p of slot.predictions) {
          checked += 1;
          const key = teamKey(aliases, p.value);
          if (!knownClubs.has(key)) {
            unresolved.push(
              `${season.label} ${sc.competition.name} / ${slot.label} — ${p.player.handle}: "${p.value}" -> key "${key}" not found among ${knownClubs.size} known clubs`,
            );
          }
        }
      }
    }
  }

  console.log(`${checked} team predictions checked, ${unresolved.length} did not resolve\n`);
  for (const u of unresolved) console.log(`  ${u}`);
}

main().then(() => prisma.$disconnect());
