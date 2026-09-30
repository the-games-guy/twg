/**
 * Clear predictions and sessions for one season. Used to remove test data
 * before handing the app over; leaves imported history untouched.
 */
import { prisma } from "@/lib/db";

async function main() {
  const label = process.argv[2];
  if (!label) throw new Error("usage: reset-season-entries <season label>");

  const season = await prisma.season.findUniqueOrThrow({ where: { label } });
  const deleted = await prisma.prediction.deleteMany({
    where: { slot: { seasonCompetition: { seasonId: season.id } } },
  });
  const changes = await prisma.predictionChange.deleteMany({ where: { seasonId: season.id } });
  const snaps = await prisma.snapshot.deleteMany({ where: { seasonId: season.id } });
  console.log(
    `${label}: removed ${deleted.count} predictions, ${changes.count} changes, ${snaps.count} snapshots`,
  );
}
main().then(() => prisma.$disconnect());
