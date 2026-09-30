/** Switch which season the app treats as active. */
import { prisma } from "@/lib/db";

async function main() {
  const label = process.argv[2];
  if (!label) {
    const all = await prisma.season.findMany({ orderBy: { startYear: "desc" } });
    for (const s of all) console.log(`${s.isActive ? "*" : " "} ${s.label}`);
    return;
  }
  await prisma.season.updateMany({ data: { isActive: false } });
  await prisma.season.update({ where: { label }, data: { isActive: true } });
  console.log(`active season: ${label}`);
}
main().then(() => prisma.$disconnect());
