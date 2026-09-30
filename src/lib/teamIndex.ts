/**
 * Loads the alias index from the database.
 *
 * Kept out of teams.ts so that module stays pure and directly testable — it has
 * no database dependency and never should.
 */

import { prisma } from "./db";
import { SEED_ALIASES } from "./aliases";
import { buildAliasIndex, normalise, type AliasIndex } from "./teams";

export async function loadAliasIndex(): Promise<AliasIndex> {
  const aliases = await prisma.teamAlias.findMany({ include: { team: true } });
  return buildAliasIndex(
    aliases.map((a) => ({ alias: a.alias, canonical: a.team.name })),
  );
}

/** Upsert SEED_ALIASES into TeamAlias. Idempotent. */
export async function applySeedAliases(): Promise<void> {
  for (const { alias, canonical } of SEED_ALIASES) {
    // Find the club by any spelling it's already known under, not by exact
    // name: after merge-duplicate-teams.ts or a results sync the row may be
    // named "Manchester City FC", and creating a fresh "Manchester City" row
    // here would fork the club again.
    const known = await prisma.teamAlias.findUnique({ where: { alias: normalise(canonical) } });
    const team = known
      ? { id: known.teamId }
      : await prisma.team.upsert({ where: { name: canonical }, update: {}, create: { name: canonical } });
    // Stored normalised, matching how the lookup index is keyed.
    await prisma.teamAlias.upsert({
      where: { alias: normalise(alias) },
      update: { teamId: team.id },
      create: { alias: normalise(alias), teamId: team.id },
    });
  }
}
