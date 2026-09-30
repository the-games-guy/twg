/**
 * Exercise the bot without Signal. Reads commands on stdin and prints the
 * replies, so command output can be checked before it reaches the group.
 *
 *   npx tsx scripts/bot-console.ts KV
 *   > /leaderboard
 */

import { createInterface } from "node:readline";
import { prisma } from "@/lib/db";
import { handleCommand } from "@/worker/commands";

async function main() {
  const handle = process.argv[2] ?? "Tok";
  const player = await prisma.player.findUnique({ where: { handle } });
  if (!player) {
    console.error(`No player "${handle}".`);
    process.exit(1);
  }

  console.log(`Acting as ${player.handle}. Type a command, or "quit".\n`);
  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: "> " });
  rl.prompt();

  for await (const line of rl) {
    if (line.trim() === "quit") break;
    try {
      const reply = await handleCommand(line, {
        playerId: player.id,
        playerHandle: player.handle,
        isGroup: true,
      });
      console.log(reply ?? "(no reply — not a command)");
    } catch (e) {
      console.error("error:", e instanceof Error ? e.message : e);
    }
    console.log();
    rl.prompt();
  }
  await prisma.$disconnect();
}

main();
