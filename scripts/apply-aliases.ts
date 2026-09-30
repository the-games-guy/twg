/**
 * Apply src/lib/aliases.ts to the database without re-running the full seed
 * (which also resets player display names and admin flags). Idempotent.
 */
import { prisma } from "@/lib/db";
import { SEED_ALIASES } from "@/lib/aliases";
import { applySeedAliases } from "@/lib/teamIndex";

applySeedAliases()
  .then(() => console.log(`team aliases applied: ${SEED_ALIASES.length}`))
  .finally(() => prisma.$disconnect());
