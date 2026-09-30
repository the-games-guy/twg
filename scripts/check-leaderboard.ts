import { prisma } from "@/lib/db";
import { buildLeaderboard } from "@/lib/reports/leaderboard";

async function main() {
  const label = process.argv[2] ?? "2025/26";
  const season = await prisma.season.findUniqueOrThrow({ where: { label } });
  const board = await buildLeaderboard(season.id);
  console.log(`\n${board.seasonLabel}`);
  for (const r of board.rows) {
    console.log(`  ${r.rank}. ${r.playerHandle.padEnd(4)} ${String(r.total).padStart(3)} pts   (${r.pending} undecided)`);
  }
  if (board.awaiting.length) console.log(`  awaiting: ${board.awaiting.join(", ")}`);
}
main().then(() => prisma.$disconnect());
