/** Fetch results for the active season immediately. */
import { prisma } from "@/lib/db";
import { syncActiveSeason } from "@/lib/results/sync";

async function main() {
  const report = await syncActiveSeason();
  if (!report) return console.log("No active season.");
  console.log(`${report.seasonLabel}`);
  for (const u of report.updated) console.log(`  updated  ${u}`);
  for (const s of report.skipped) console.log(`  manual   ${s.competition} (${s.reason})`);
  for (const f of report.failed) console.log(`  FAILED   ${f.competition}: ${f.error}`);
}
main().then(() => prisma.$disconnect());
