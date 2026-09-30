/**
 * The always-on process: scheduled results syncs, the weekly digest, and the
 * Signal listener.
 *
 * Kept separate from the web app because Next.js request handlers are the wrong
 * place for long-lived loops, and because this is the piece that must survive
 * on a home machine for nine months at a stretch. Every job is defensive: a
 * failed sync logs and waits for the next tick rather than taking the process
 * down and silencing the bot.
 */

import cron from "node-cron";
import { applyPragmas, prisma } from "@/lib/db";
import { syncActiveSeason } from "@/lib/results/sync";
import { buildWeeklyDigest } from "./jobs/weeklyDigest";
import {
  isSignalConfigured,
  receiveMessages,
  sendMessage,
  sendToGroup,
} from "@/lib/signal/client";
import { handleCommand, identifySender } from "./commands";

const TIMEZONE = process.env.APP_TIMEZONE || "UTC";
const log = (...args: unknown[]) => console.log(new Date().toISOString(), ...args);

let shuttingDown = false;

async function runSync(reason: string): Promise<void> {
  try {
    const report = await syncActiveSeason();
    if (!report) return log(`sync (${reason}): no active season`);
    log(
      `sync (${reason}): ${report.updated.length} updated, ` +
        `${report.skipped.length} manual, ${report.failed.length} failed`,
    );
    for (const f of report.failed) log(`  ! ${f.competition}: ${f.error}`);
  } catch (e) {
    log(`sync (${reason}) threw:`, e instanceof Error ? e.message : e);
  }
}

async function runDigest(): Promise<void> {
  try {
    const text = await buildWeeklyDigest();
    if (!text) return log("digest: nothing to post");
    if (!isSignalConfigured() || !process.env.SIGNAL_GROUP_ID) {
      return log("digest ready but Signal is not configured:\n" + text);
    }
    await sendToGroup(text);
    log("digest posted");
  } catch (e) {
    log("digest threw:", e instanceof Error ? e.message : e);
  }
}

/** Poll Signal and answer commands. */
async function signalLoop(): Promise<void> {
  const groupId = process.env.SIGNAL_GROUP_ID?.replace(/^group\./, "");

  while (!shuttingDown) {
    try {
      const messages = await receiveMessages(10);
      for (const msg of messages) {
        // Ignore other groups entirely; answer direct messages from anyone we
        // can identify.
        if (msg.groupId && groupId && msg.groupId.replace(/^group\./, "") !== groupId) {
          continue;
        }

        const sender = await identifySender(msg.sourceUuid, msg.sourceNumber);
        const reply = await handleCommand(msg.text, {
          playerId: sender?.id ?? null,
          playerHandle: sender?.handle ?? null,
          isGroup: Boolean(msg.groupId),
        });
        if (!reply) continue;

        // Anything that could expose one player's picks goes to a DM even when
        // it was asked in the group, so an answer can never leak to the others.
        const isPrivate = /^\/(me|picks|predictions|changes)\b/i.test(msg.text.trim());
        const recipient =
          msg.groupId && !isPrivate
            ? `group.${msg.groupId.replace(/^group\./, "")}`
            : msg.sourceNumber ?? msg.sourceUuid;

        await sendMessage(recipient, reply);
        log(`replied to ${sender?.handle ?? "unknown"} (${msg.text.split(/\s+/)[0]})`);
      }
    } catch (e) {
      log("signal loop error:", e instanceof Error ? e.message : e);
      await new Promise((r) => setTimeout(r, 15_000));
    }
  }
}

async function main() {
  await applyPragmas();
  log(`worker starting · timezone ${TIMEZONE}`);

  // Results four times a day: enough to keep a leaderboard current, far under
  // the free tier's 10 requests/minute.
  cron.schedule("0 */6 * * *", () => void runSync("scheduled"), { timezone: TIMEZONE });

  // Monday morning digest.
  cron.schedule("0 9 * * 1", () => void runDigest(), { timezone: TIMEZONE });

  await runSync("startup");

  if (isSignalConfigured()) {
    log("signal listener starting");
    void signalLoop();
  } else {
    log("signal not configured — set SIGNAL_API_URL and SIGNAL_BOT_NUMBER to enable the bot");
  }
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    log(`${signal} received, shutting down`);
    shuttingDown = true;
    void prisma.$disconnect().then(() => process.exit(0));
  });
}

main().catch((e) => {
  console.error("worker failed to start:", e);
  process.exit(1);
});
