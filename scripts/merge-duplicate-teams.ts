/**
 * Merge Team rows that fork into duplicates of the same real-world club.
 *
 * Historically `upsertTeam` in src/lib/results/sync.ts matched Team.name
 * exactly against the football-data.org name (e.g. "Manchester City FC"). A
 * club already seeded or imported under a different exact spelling (e.g.
 * "Manchester City") didn't match, so the sync created a second Team row for
 * the same club. Its TeamAlias rows then split across both rows, so some
 * spellings of the club (e.g. "Man City") stopped resolving against results
 * recorded under the other spelling — silently producing "X is not in this
 * league's table" for a real, correctly-typed pick.
 *
 * `sync.ts` now resolves an existing Team by alias before falling back to a
 * name-keyed upsert, so this should not happen again going forward. This
 * script is the one-off repair for rows that already forked before that fix
 * landed: find every group of Teams that normalise to the same key, merge
 * each group onto a single keeper row, and re-point every alias onto it.
 *
 * Safe to re-run — a second pass finds nothing left to merge.
 */
import { prisma } from "@/lib/db";
import { normalise } from "@/lib/teams";

async function main() {
  const teams = await prisma.team.findMany({ include: { aliases: true } });

  const groups = new Map<string, typeof teams>();
  for (const team of teams) {
    const key = normalise(team.name);
    const group = groups.get(key);
    if (group) group.push(team);
    else groups.set(key, [team]);
  }

  let mergedGroups = 0;
  let mergedRows = 0;

  for (const [key, group] of groups) {
    if (group.length < 2) continue;

    // Keep the row with the most aliases already attached (the one the rest
    // of the app has been resolving through), tie-broken toward a name that
    // isn't provider-suffixed with "FC" (the seed/import spelling), then away
    // from ALL-CAPS words longer than a plausible abbreviation (a
    // data-quality quirk in some provider payloads — "VfL BOCHUM" instead of
    // "VfL Bochum" — not how anyone wants a club's name displayed; short
    // all-caps tokens like "PSG" or "VfL" are left alone since those really
    // are how the club is styled), then the shorter name.
    const shoutingWords = (name: string) =>
      name.split(/\s+/).filter((w) => w.length > 3 && w === w.toUpperCase()).length;
    const keeper = [...group].sort((a, b) => {
      if (b.aliases.length !== a.aliases.length) return b.aliases.length - a.aliases.length;
      const aFc = /\bFC$/i.test(a.name);
      const bFc = /\bFC$/i.test(b.name);
      if (aFc !== bFc) return aFc ? 1 : -1;
      const aShout = shoutingWords(a.name);
      const bShout = shoutingWords(b.name);
      if (aShout !== bShout) return aShout - bShout;
      return a.name.length - b.name.length;
    })[0];

    const duplicates = group.filter((t) => t.id !== keeper.id);

    console.log(
      `merging "${key}": keeping "${keeper.name}" (${keeper.aliases.length} aliases), ` +
        `dropping ${duplicates.map((d) => `"${d.name}" (${d.aliases.length} aliases)`).join(", ")}`,
    );

    for (const dup of duplicates) {
      await prisma.teamAlias.updateMany({ where: { teamId: dup.id }, data: { teamId: keeper.id } });
      await prisma.team.delete({ where: { id: dup.id } });
      mergedRows += 1;
    }

    // Belt-and-braces: make sure the keeper resolves under its own name even
    // if neither it nor its former duplicates ever got an explicit self-alias.
    await prisma.teamAlias.upsert({
      where: { alias: key },
      update: { teamId: keeper.id },
      create: { alias: key, teamId: keeper.id },
    });

    mergedGroups += 1;
  }

  console.log(`\n${mergedGroups} duplicate group(s) merged, ${mergedRows} Team row(s) removed`);
}

main().then(() => prisma.$disconnect());
