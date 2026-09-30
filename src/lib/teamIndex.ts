/**
 * Loads the alias index from the database.
 *
 * Kept out of teams.ts so that module stays pure and directly testable — it has
 * no database dependency and never should.
 */

import { prisma } from "./db";
import { buildAliasIndex, type AliasIndex } from "./teams";

export async function loadAliasIndex(): Promise<AliasIndex> {
  const aliases = await prisma.teamAlias.findMany({ include: { team: true } });
  return buildAliasIndex(
    aliases.map((a) => ({ alias: a.alias, canonical: a.team.name })),
  );
}
