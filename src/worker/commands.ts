/**
 * Command dispatch for the Signal bot.
 *
 * The bot answers questions and never accepts predictions: the group chat is
 * shared, so anything typed there is visible to everyone, which is precisely
 * what this app exists to prevent. Entry stays on the web app.
 */

import { prisma } from "@/lib/db";
import {
  HELP_TEXT,
  changesReport,
  honourBoardReport,
  leaderboardReport,
  playerCardReport,
  predictionsReport,
} from "@/lib/reports/digest";

export interface CommandContext {
  /** Resolved from the Signal sender, null if we don't know who this is. */
  playerId: string | null;
  playerHandle: string | null;
  isGroup: boolean;
}

/** Map a Signal sender to a player, remembering the uuid on first contact. */
export async function identifySender(
  sourceUuid: string,
  sourceNumber: string | null,
): Promise<{ id: string; handle: string } | null> {
  const byUuid = await prisma.player.findFirst({ where: { signalUuid: sourceUuid } });
  if (byUuid) return { id: byUuid.id, handle: byUuid.handle };

  if (sourceNumber) {
    const byNumber = await prisma.player.findFirst({ where: { signalNumber: sourceNumber } });
    if (byNumber) {
      await prisma.player.update({
        where: { id: byNumber.id },
        data: { signalUuid: sourceUuid },
      });
      return { id: byNumber.id, handle: byNumber.handle };
    }
  }
  return null;
}

/**
 * Returns null when the message is not addressed to the bot, so ordinary group
 * chatter passes without a reply.
 */
export async function handleCommand(
  text: string,
  ctx: CommandContext,
): Promise<string | null> {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return null;

  const [rawCommand, ...args] = trimmed.slice(1).split(/\s+/);
  const command = rawCommand.toLowerCase();
  const arg = args.join(" ").trim();

  switch (command) {
    case "help":
      return HELP_TEXT;

    case "leaderboard":
    case "standings":
    case "table":
      return leaderboardReport();

    case "honours":
    case "honors":
    case "history":
      return honourBoardReport();

    case "me":
      if (!ctx.playerHandle) return unknownSender();
      return playerCardReport(ctx.playerHandle);

    case "card":
      if (!arg) return "Which player? e.g. /card MC";
      return playerCardReport(arg);

    case "picks":
    case "predictions":
      if (!ctx.playerId) return unknownSender();
      if (!arg) return "Whose picks? e.g. /picks MC";
      return predictionsReport(arg, ctx.playerId);

    case "changes":
      if (!ctx.playerId) return unknownSender();
      return changesReport(ctx.playerId);

    default:
      return `Don't know "/${command}". Try /help.`;
  }
}

function unknownSender(): string {
  return (
    "I don't recognise you yet. Ask whoever runs the comp to add your Signal " +
    "number against your player, then try again."
  );
}
