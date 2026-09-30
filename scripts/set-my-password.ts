/** One-off bootstrap: set a player's password directly, for when there's no
 *  admin session yet to do it through the UI. */
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/password";

async function main() {
  const handle = process.argv[2];
  const password = process.argv[3];
  const player = await prisma.player.update({
    where: { handle },
    data: { passwordHash: hashPassword(password), failedLoginAttempts: 0, lockedUntil: null },
  });
  console.log(`Password set for ${player.handle} (${player.email})`);
}
main().then(() => prisma.$disconnect());
