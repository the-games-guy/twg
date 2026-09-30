/** Manufacture a session token for local testing without going through OAuth. */
import { prisma } from "@/lib/db";
import { createSession } from "@/lib/auth";

async function main() {
  const handle = process.argv[2] ?? "Tok";
  const player = await prisma.player.findUniqueOrThrow({ where: { handle } });
  const token = await createSession(player.id, "test-browser");
  console.log(token);
}
main().then(() => prisma.$disconnect());
