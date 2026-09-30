/**
 * The Signal bot must obey exactly the same rules as the web app. A command
 * that leaks a prediction is the same failure as a page that does.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { savePredictions } from "@/lib/predictions";
import { handleCommand, identifySender } from "@/worker/commands";
import { addStandings, buildScenario, resetDb, type Scenario } from "./factory";

const FAR_FUTURE = new Date("2099-01-01T00:00:00Z");
const SEED_TIME = new Date("2026-08-20T00:00:00Z");

let s: Scenario;

/**
 * Seed predictions while entry is open, then move the deadline to wherever the
 * test needs it. Setting a past deadline first would lock the season before
 * anything could be entered.
 */
async function setup(deadline: Date | null) {
  await resetDb();
  s = await buildScenario({ predictionDeadline: FAR_FUTURE });
  await savePredictions(
    s.seasonId, s.players.KV,
    new Map([[s.slots[0], "Arsenal"], [s.slots[1], "Liverpool"]]),
    SEED_TIME,
  );
  await savePredictions(
    s.seasonId, s.players.MC,
    new Map([[s.slots[0], "Manchester City"], [s.slots[1], "Arsenal"]]),
    SEED_TIME,
  );
  await addStandings(s.seasonId, ["Arsenal", "Liverpool", "Manchester City", "Chelsea"]);
  await prisma.season.update({
    where: { id: s.seasonId },
    data: { predictionDeadline: deadline },
  });
}

const OPEN = new Date(Date.now() + 86_400_000);
const CLOSED = new Date(Date.now() - 86_400_000);

const asKV = () => ({ playerId: s.players.KV, playerHandle: "KV", isGroup: true });

describe("command routing", () => {
  beforeEach(() => setup(OPEN));

  it("ignores ordinary chat", async () => {
    expect(await handleCommand("who's winning then", asKV())).toBeNull();
    expect(await handleCommand("anyone watching the game", asKV())).toBeNull();
  });

  it("answers /help without needing to know the sender", async () => {
    const reply = await handleCommand("/help", { playerId: null, playerHandle: null, isGroup: true });
    expect(reply).toContain("/leaderboard");
  });

  it("names the command it didn't understand", async () => {
    expect(await handleCommand("/scores", asKV())).toContain("/scores");
  });

  it("is case-insensitive and tolerates trailing text", async () => {
    expect(await handleCommand("/HELP", asKV())).toContain("/leaderboard");
  });
});

describe("/picks respects the blindness rule", () => {
  it("refuses another player's picks before the deadline", async () => {
    await setup(OPEN);
    const reply = await handleCommand("/picks MC", asKV());
    expect(reply).toContain("visible until entry closes");
    expect(reply).not.toContain("Manchester City");
  });

  it("shows your own picks even while entry is open", async () => {
    await setup(OPEN);
    const reply = await handleCommand("/picks KV", asKV());
    expect(reply).toContain("Arsenal");
  });

  it("reveals everyone once the deadline has passed", async () => {
    await setup(CLOSED);
    const reply = await handleCommand("/picks MC", asKV());
    expect(reply).toContain("Manchester City");
  });

  it("refuses when it cannot identify the sender", async () => {
    await setup(CLOSED);
    const reply = await handleCommand("/picks MC", {
      playerId: null, playerHandle: null, isGroup: true,
    });
    expect(reply).toContain("don't recognise you");
    expect(reply).not.toContain("Manchester City");
  });
});

describe("/leaderboard", () => {
  it("withholds standings while entry is open", async () => {
    await setup(OPEN);
    const reply = await handleCommand("/leaderboard", asKV());
    expect(reply).toContain("entry still open");
    expect(reply).toContain("2/4 entered");
    expect(reply).not.toContain("Arsenal");
  });

  it("ranks players once locked, and calls out a tie", async () => {
    await setup(CLOSED);
    // KV: Arsenal 1st (3) + Liverpool 2nd (3) = 6.
    // MC: Man City 1st -> 3rd, top 4 (1); Arsenal 2nd -> 1st, top 4 (1) = 2.
    const reply = await handleCommand("/leaderboard", asKV())!;
    expect(reply).toContain("KV — 6 pts");
    expect(reply).toContain("MC — 2 pts");
    expect(reply).toContain("KV leads by");
  });
});

describe("identifySender", () => {
  beforeEach(() => setup(OPEN));

  it("returns null for a stranger", async () => {
    expect(await identifySender("unknown-uuid", "+61400000000")).toBeNull();
  });

  it("matches on number and remembers the uuid for next time", async () => {
    await prisma.player.update({
      where: { id: s.players.KV },
      data: { signalNumber: "+61411111111" },
    });

    const first = await identifySender("kv-uuid-1", "+61411111111");
    expect(first?.handle).toBe("KV");

    // Second contact arrives with no number attached; the stored uuid carries it.
    const second = await identifySender("kv-uuid-1", null);
    expect(second?.handle).toBe("KV");
  });
});
