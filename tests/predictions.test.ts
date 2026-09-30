/**
 * The two rules that justify replacing the spreadsheet:
 *   1. Nobody can see anybody else's picks before the deadline.
 *   2. After the deadline, changes are limited to 3, in January only.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  PredictionInvalidError,
  PredictionLockedError,
  PredictionsHiddenError,
  changeCost,
  countChanges,
  getEntryProgress,
  getOwnPredictions,
  getPlayerPredictions,
  savePredictions,
} from "@/lib/predictions";
import { buildScenario, resetDb, type Scenario } from "./factory";

const DEADLINE = new Date("2026-09-01T00:00:00Z");
const JAN_WINDOW = {
  changeWindowStart: new Date("2027-01-01T00:00:00Z"),
  changeWindowEnd: new Date("2027-01-31T23:59:59Z"),
};

const BEFORE_DEADLINE = new Date("2026-08-20T00:00:00Z");
const AFTER_DEADLINE = new Date("2026-10-01T00:00:00Z");
const IN_WINDOW = new Date("2027-01-15T00:00:00Z");
const AFTER_WINDOW = new Date("2027-02-01T00:00:00Z");

let s: Scenario;

async function seedPicks(scenario: Scenario, playerId: string, values: string[]) {
  await savePredictions(
    scenario.seasonId,
    playerId,
    new Map(values.map((v, i) => [scenario.slots[i], v])),
    BEFORE_DEADLINE,
  );
}

describe("blind entry", () => {
  beforeEach(async () => {
    await resetDb();
    s = await buildScenario({ predictionDeadline: DEADLINE, ...JAN_WINDOW });
    await seedPicks(s, s.players.KV, ["Arsenal", "Liverpool", "Chelsea", "Man City"]);
    await seedPicks(s, s.players.MC, ["Arsenal", "Liverpool", "Man City", "Spurs"]);
  });

  it("lets a player read their own picks at any time", async () => {
    const own = await getPlayerPredictions(s.seasonId, s.players.KV, s.players.KV, BEFORE_DEADLINE);
    expect(own.get(s.slots[0])).toBe("Arsenal");
  });

  it("refuses another player's picks before the deadline", async () => {
    await expect(
      getPlayerPredictions(s.seasonId, s.players.MC, s.players.KV, BEFORE_DEADLINE),
    ).rejects.toBeInstanceOf(PredictionsHiddenError);
  });

  it("fails closed rather than returning an empty set", async () => {
    // The distinction matters: an empty map would read as "MC hasn't entered
    // anything", which is itself information and happens to be false here.
    await expect(
      getPlayerPredictions(s.seasonId, s.players.MC, s.players.KV, BEFORE_DEADLINE),
    ).rejects.toThrow();
    const actuallyEntered = await getOwnPredictions(s.seasonId, s.players.MC);
    expect(actuallyEntered.size).toBe(4);
  });

  it("releases everyone's picks once the deadline passes", async () => {
    const theirs = await getPlayerPredictions(s.seasonId, s.players.MC, s.players.KV, AFTER_DEADLINE);
    expect(theirs.get(s.slots[3])).toBe("Spurs");
  });

  it("reports entry progress without leaking content", async () => {
    const progress = await getEntryProgress(s.seasonId);
    const byHandle = Object.fromEntries(progress.map((p) => [p.handle, p]));
    expect(byHandle.KV.entered).toBe(4);
    expect(byHandle.MC.entered).toBe(4);
    expect(byHandle.Tok.entered).toBe(0);
    expect(byHandle.KV.total).toBe(4);
    // No prediction values anywhere in the payload.
    expect(JSON.stringify(progress)).not.toContain("Arsenal");
  });
});

describe("editing before the deadline", () => {
  beforeEach(async () => {
    await resetDb();
    s = await buildScenario({ predictionDeadline: DEADLINE, ...JAN_WINDOW });
    await seedPicks(s, s.players.KV, ["Arsenal", "Liverpool", "Chelsea", "Man City"]);
  });

  it("is unlimited and spends no change budget", async () => {
    // Cycle through clubs not already occupying another slot, so each save is
    // valid on its own terms.
    for (const team of ["Newcastle", "Brighton", "Arsenal"]) {
      await savePredictions(s.seasonId, s.players.KV, new Map([[s.slots[0], team]]), BEFORE_DEADLINE);
    }
    expect(await countChanges(s.seasonId, s.players.KV)).toBe(0);
    const own = await getOwnPredictions(s.seasonId, s.players.KV);
    expect(own.get(s.slots[0])).toBe("Arsenal");
  });

  it("supersedes rather than overwrites, keeping the original answerable", async () => {
    await savePredictions(s.seasonId, s.players.KV, new Map([[s.slots[0], "Newcastle"]]), BEFORE_DEADLINE);
    const history = await prisma.prediction.findMany({
      where: { playerId: s.players.KV, slotId: s.slots[0] },
      orderBy: { createdAt: "asc" },
    });
    expect(history).toHaveLength(2);
    expect(history[0].value).toBe("Arsenal");
    expect(history[0].supersededAt).not.toBeNull();
    expect(history[1].value).toBe("Newcastle");
    expect(history[1].supersededAt).toBeNull();
  });
});

describe("the January change window", () => {
  beforeEach(async () => {
    await resetDb();
    s = await buildScenario({ predictionDeadline: DEADLINE, ...JAN_WINDOW, changeBudget: 3 });
    await seedPicks(s, s.players.KV, ["Arsenal", "Liverpool", "Chelsea", "Man City"]);
  });

  it("is closed in December", async () => {
    await expect(
      savePredictions(s.seasonId, s.players.KV, new Map([[s.slots[0], "Newcastle"]]), AFTER_DEADLINE),
    ).rejects.toBeInstanceOf(PredictionLockedError);
  });

  it("is closed in February", async () => {
    await expect(
      savePredictions(s.seasonId, s.players.KV, new Map([[s.slots[0], "Newcastle"]]), AFTER_WINDOW),
    ).rejects.toBeInstanceOf(PredictionLockedError);
  });

  it("is open in January", async () => {
    const r = await savePredictions(
      s.seasonId, s.players.KV, new Map([[s.slots[0], "Newcastle"]]), IN_WINDOW,
    );
    expect(r.changesUsed).toBe(1);
    expect(r.changesRemaining).toBe(2);
  });

  it("rejects a fourth change", async () => {
    for (const team of ["Newcastle", "Brighton", "Everton"]) {
      await savePredictions(s.seasonId, s.players.KV, new Map([[s.slots[0], team]]), IN_WINDOW);
    }
    expect(await countChanges(s.seasonId, s.players.KV)).toBe(3);
    await expect(
      savePredictions(s.seasonId, s.players.KV, new Map([[s.slots[0], "Fulham"]]), IN_WINDOW),
    ).rejects.toThrow(/only 0 of your 3 remain/);
  });

  it("counts a straight swap of two of your own picks as one change", async () => {
    // "If you are swapping 1 team with another in your list (winner vs runner
    // up) this is treated as 1 change."
    const r = await savePredictions(
      s.seasonId,
      s.players.KV,
      new Map([
        [s.slots[0], "Liverpool"], // was Arsenal
        [s.slots[1], "Arsenal"],   // was Liverpool
      ]),
      IN_WINDOW,
    );
    expect(r.saved).toBe(2);
    expect(r.changesUsed).toBe(1);
    expect(r.changesRemaining).toBe(2);
  });

  it("counts two unrelated edits as two changes", async () => {
    await expect(
      savePredictions(
        s.seasonId,
        s.players.KV,
        new Map([
          [s.slots[0], "Newcastle"],
          [s.slots[1], "Brighton"],
        ]),
        IN_WINDOW,
      ),
    ).resolves.toMatchObject({ changesUsed: 2, changesRemaining: 1 });
  });

  it("charges nothing for a save that changes nothing", async () => {
    const r = await savePredictions(
      s.seasonId, s.players.KV, new Map([[s.slots[0], "Arsenal"]]), IN_WINDOW,
    );
    expect(r.saved).toBe(0);
    expect(r.changesUsed).toBe(0);
  });
});

describe("changeCost", () => {
  it("prices a three-way rotation as three changes, not one", () => {
    // A rotation is not a swap: no pair of slots exchanges values.
    const existing = new Map([["a", "X"], ["b", "Y"], ["c", "Z"]]);
    const changed: [string, string][] = [["a", "Y"], ["b", "Z"], ["c", "X"]];
    expect(changeCost(changed, existing)).toBe(3);
  });

  it("prices two independent swaps as two changes", () => {
    const existing = new Map([["a", "X"], ["b", "Y"], ["c", "P"], ["d", "Q"]]);
    const changed: [string, string][] = [["a", "Y"], ["b", "X"], ["c", "Q"], ["d", "P"]];
    expect(changeCost(changed, existing)).toBe(2);
  });
});

describe("duplicate picks", () => {
  beforeEach(async () => {
    await resetDb();
    s = await buildScenario({ predictionDeadline: DEADLINE, ...JAN_WINDOW });
  });

  it("rejects the same club in two league positions", async () => {
    await expect(
      savePredictions(
        s.seasonId,
        s.players.KV,
        new Map([[s.slots[0], "Arsenal"], [s.slots[1], "Arsenal"]]),
        BEFORE_DEADLINE,
      ),
    ).rejects.toThrow(/a club only finishes in one place/);
  });

  it("catches a collision against picks saved in an earlier request", async () => {
    // The submitted form contains one slot, but the clash is with a stored
    // value — validation must run on the merged picture.
    await seedPicks(s, s.players.KV, ["Arsenal", "Liverpool", "Chelsea", "Newcastle"]);
    await expect(
      savePredictions(s.seasonId, s.players.KV, new Map([[s.slots[3], "Arsenal"]]), BEFORE_DEADLINE),
    ).rejects.toThrow(/can't be both/);
  });

  it("matches on spelling variants, not exact strings", async () => {
    // Aliases come from the results sync; seed the one this test needs.
    const team = await prisma.team.create({ data: { name: "Manchester City" } });
    for (const alias of ["man city", "manchester city"]) {
      await prisma.teamAlias.create({ data: { alias, teamId: team.id } });
    }
    await expect(
      savePredictions(
        s.seasonId,
        s.players.KV,
        new Map([[s.slots[0], "Man City"], [s.slots[1], "Manchester City FC"]]),
        BEFORE_DEADLINE,
      ),
    ).rejects.toThrow(/can't be both/);
  });

  it("names both offending slots so the player can see the clash", async () => {
    try {
      await savePredictions(
        s.seasonId,
        s.players.KV,
        new Map([[s.slots[0], "Arsenal"], [s.slots[2], "Arsenal"]]),
        BEFORE_DEADLINE,
      );
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(PredictionInvalidError);
      expect((e as PredictionInvalidError).slotIds).toEqual([s.slots[0], s.slots[2]]);
    }
  });

  it("allows the same club in different competitions", async () => {
    // Arsenal can win the league and the FA Cup.
    const other = await prisma.competition.create({
      data: { key: "fa-cup", name: "FA Cup", kind: "CUP", providerCode: null },
    });
    const sc = await prisma.seasonCompetition.create({
      data: { seasonId: s.seasonId, competitionId: other.id, displayOrder: 1 },
    });
    const cupSlot = await prisma.slot.create({
      data: { seasonCompetitionId: sc.id, kind: "CUP_WINNER", ordinal: 1, label: "FA Cup Winner", displayOrder: 10 },
    });

    await expect(
      savePredictions(
        s.seasonId,
        s.players.KV,
        new Map([[s.slots[0], "Arsenal"], [cupSlot.id, "Arsenal"]]),
        BEFORE_DEADLINE,
      ),
    ).resolves.toMatchObject({ saved: 2 });
  });

  it("allows a Champions League winner to also be one of your semi-finalists", async () => {
    // Deliberate strategy, not a mistake: a safer double if they get there, at
    // the cost of one of the four coverage spots. Both slots score.
    const ucl = await prisma.competition.create({
      data: { key: "ucl", name: "Champions League", kind: "CUP", providerCode: "CL" },
    });
    const sc = await prisma.seasonCompetition.create({
      data: { seasonId: s.seasonId, competitionId: ucl.id, displayOrder: 2 },
    });
    const winner = await prisma.slot.create({
      data: { seasonCompetitionId: sc.id, kind: "CUP_WINNER", ordinal: 1, label: "UCL - Winner", displayOrder: 20 },
    });
    const semi = await prisma.slot.create({
      data: { seasonCompetitionId: sc.id, kind: "CUP_SEMI_FINALIST", ordinal: 1, label: "Semi Finalist", displayOrder: 21 },
    });

    await expect(
      savePredictions(
        s.seasonId,
        s.players.KV,
        new Map([[winner.id, "Liverpool"], [semi.id, "Liverpool"]]),
        BEFORE_DEADLINE,
      ),
    ).resolves.toMatchObject({ saved: 2 });
  });

  it("allows the Championship winner to also be a promotion pick", async () => {
    // The champion is promoted, so both picks can pay.
    const ch = await prisma.competition.create({
      data: { key: "championship", name: "Championship", kind: "LEAGUE", providerCode: "ELC" },
    });
    const sc = await prisma.seasonCompetition.create({
      data: { seasonId: s.seasonId, competitionId: ch.id, displayOrder: 3 },
    });
    const winner = await prisma.slot.create({
      data: { seasonCompetitionId: sc.id, kind: "LEAGUE_POSITION", ordinal: 1, label: "Championship - Winner", displayOrder: 30 },
    });
    const promo = await prisma.slot.create({
      data: { seasonCompetitionId: sc.id, kind: "PROMOTION", ordinal: 1, label: "Championship - Promotion", displayOrder: 31 },
    });

    await expect(
      savePredictions(
        s.seasonId,
        s.players.KV,
        new Map([[winner.id, "Coventry"], [promo.id, "Coventry"]]),
        BEFORE_DEADLINE,
      ),
    ).resolves.toMatchObject({ saved: 2 });
  });

  it("does not block the golden-boot number, which is not a club", async () => {
    const sc = await prisma.seasonCompetition.findFirstOrThrow({ where: { seasonId: s.seasonId } });
    const player = await prisma.slot.create({
      data: { seasonCompetitionId: sc.id, kind: "GOLDEN_BOOT_PLAYER", ordinal: 1, label: "Golden Boot", displayOrder: 40, valueType: "PLAYER" },
    });
    const count = await prisma.slot.create({
      data: { seasonCompetitionId: sc.id, kind: "GOLDEN_BOOT_COUNT", ordinal: 1, label: "Golden Boot #", displayOrder: 41, valueType: "NUMBER" },
    });

    await expect(
      savePredictions(
        s.seasonId,
        s.players.KV,
        new Map([[player.id, "Haaland"], [count.id, "24"]]),
        BEFORE_DEADLINE,
      ),
    ).resolves.toMatchObject({ saved: 2 });
  });
});
