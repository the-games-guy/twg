/**
 * Reading and writing predictions.
 *
 * The competition's central rule lives here: before the deadline, a player can
 * see only their own picks. That is enforced at the data layer rather than in
 * the UI, because the whole reason for replacing the spreadsheet was that its
 * "privacy" depended on people not scrolling sideways. A wrong URL, a stale
 * bookmark, or a hand-rolled fetch must all fail closed.
 */

import { prisma } from "./db";
import { teamKey, type AliasIndex } from "./teams";
import { loadAliasIndex } from "./teamIndex";

export interface SlotView {
  id: string;
  kind: string;
  ordinal: number;
  label: string;
  valueType: string;
  competitionKey: string;
  competitionName: string;
  displayOrder: number;
}

export interface SeasonState {
  id: string;
  label: string;
  predictionDeadline: Date | null;
  changeWindowStart: Date | null;
  changeWindowEnd: Date | null;
  changeBudget: number;
  isLocked: boolean;
  changeWindowOpen: boolean;
}

export async function getActiveSeason(now = new Date()): Promise<SeasonState | null> {
  const season = await prisma.season.findFirst({
    where: { isActive: true },
    orderBy: { startYear: "desc" },
  });
  if (!season) return null;
  return toSeasonState(season, now);
}

export function toSeasonState(
  season: {
    id: string;
    label: string;
    predictionDeadline: Date | null;
    changeWindowStart: Date | null;
    changeWindowEnd: Date | null;
    changeBudget: number;
  },
  now = new Date(),
): SeasonState {
  const isLocked = Boolean(season.predictionDeadline && season.predictionDeadline <= now);
  const changeWindowOpen = Boolean(
    season.changeWindowStart &&
      season.changeWindowEnd &&
      season.changeWindowStart <= now &&
      now <= season.changeWindowEnd,
  );
  return { ...season, isLocked, changeWindowOpen };
}

export async function getSlots(seasonId: string): Promise<SlotView[]> {
  const rows = await prisma.slot.findMany({
    where: { seasonCompetition: { seasonId } },
    include: { seasonCompetition: { include: { competition: true } } },
    orderBy: { displayOrder: "asc" },
  });
  return rows.map((s) => ({
    id: s.id,
    kind: s.kind,
    ordinal: s.ordinal,
    label: s.label,
    valueType: s.valueType,
    competitionKey: s.seasonCompetition.competition.key,
    competitionName: s.seasonCompetition.competition.name,
    displayOrder: s.displayOrder,
  }));
}

/** Current (non-superseded) picks for one player, keyed by slot id. */
export async function getOwnPredictions(
  seasonId: string,
  playerId: string,
): Promise<Map<string, string>> {
  const rows = await prisma.prediction.findMany({
    where: {
      playerId,
      supersededAt: null,
      slot: { seasonCompetition: { seasonId } },
    },
    select: { slotId: true, value: true },
  });
  return new Map(rows.map((r) => [r.slotId, r.value]));
}

export class PredictionsHiddenError extends Error {
  constructor(public readonly deadline: Date | null) {
    super("Predictions are hidden until the deadline passes");
    this.name = "PredictionsHiddenError";
  }
}

/**
 * Another player's picks. Throws until the deadline passes — deliberately an
 * error rather than an empty result, so a caller cannot mistake "hidden" for
 * "they haven't entered anything".
 */
export async function getPlayerPredictions(
  seasonId: string,
  targetPlayerId: string,
  requestingPlayerId: string,
  now = new Date(),
): Promise<Map<string, string>> {
  if (targetPlayerId !== requestingPlayerId) {
    const season = await prisma.season.findUniqueOrThrow({ where: { id: seasonId } });
    const state = toSeasonState(season, now);
    if (!state.isLocked) throw new PredictionsHiddenError(season.predictionDeadline);
  }
  return getOwnPredictions(seasonId, targetPlayerId);
}

/** How many players have entered a complete set. Safe to show before the lock:
 *  it reveals progress, never content. */
export async function getEntryProgress(
  seasonId: string,
): Promise<{ playerId: string; handle: string; entered: number; total: number }[]> {
  const total = await prisma.slot.count({ where: { seasonCompetition: { seasonId } } });
  const players = await prisma.player.findMany({ orderBy: { handle: "asc" } });

  const counts = await prisma.prediction.groupBy({
    by: ["playerId"],
    where: { supersededAt: null, slot: { seasonCompetition: { seasonId } } },
    _count: { _all: true },
  });
  const byPlayer = new Map(counts.map((c) => [c.playerId, c._count._all]));

  return players.map((p) => ({
    playerId: p.id,
    handle: p.handle,
    entered: byPlayer.get(p.id) ?? 0,
    total,
  }));
}

export class PredictionInvalidError extends Error {
  constructor(message: string, public readonly slotIds: string[] = []) {
    super(message);
    this.name = "PredictionInvalidError";
  }
}

/**
 * Slot kinds within which one club may only appear once.
 *
 * Deliberately narrow. Cup slots are NOT constrained: naming your Champions
 * League winner among your four semi-finalists is a legitimate strategic
 * choice — a safer double if they get there, at the cost of a coverage spot —
 * and the two slots score independently. The same applies to the Championship,
 * where the champion is also promoted, so a club may hold both the winner slot
 * and a promotion slot.
 *
 * What remains here is only what cannot be true at once: a club has exactly one
 * finishing position, and cannot both finish there and be relegated.
 */
const EXCLUSIVE_GROUPS: string[][] = [
  ["LEAGUE_POSITION", "RELEGATION"],
  ["PROMOTION"],
];

function exclusiveGroupOf(kind: string): number | null {
  const index = EXCLUSIVE_GROUPS.findIndex((group) => group.includes(kind));
  return index === -1 ? null : index;
}

/**
 * Reject only impossible duplicates — a club named twice where both picks
 * cannot pay. Anything that is merely a strategic choice is left alone.
 */
export function validateDistinctPicks(
  merged: Map<string, string>,
  slots: { id: string; kind: string; valueType: string; label: string; competitionKey: string; competitionName: string }[],
  aliases: AliasIndex,
): void {
  // (competition, exclusivity group) -> club -> the slots claiming it
  const buckets = new Map<string, Map<string, { slotId: string; label: string; raw: string }[]>>();

  for (const slot of slots) {
    if (slot.valueType !== "TEAM") continue;
    const group = exclusiveGroupOf(slot.kind);
    if (group === null) continue;

    const raw = merged.get(slot.id);
    if (!raw) continue;

    const bucketKey = `${slot.competitionKey}#${group}`;
    // Alias-aware, so "Man City" and "Manchester City FC" collide.
    const club = teamKey(aliases, raw);

    let clubs = buckets.get(bucketKey);
    if (!clubs) buckets.set(bucketKey, (clubs = new Map()));
    clubs.set(club, [...(clubs.get(club) ?? []), { slotId: slot.id, label: slot.label, raw }]);
  }

  for (const [bucketKey, clubs] of buckets) {
    const competitionKey = bucketKey.split("#")[0];
    for (const entries of clubs.values()) {
      if (entries.length < 2) continue;
      const competitionName =
        slots.find((s) => s.competitionKey === competitionKey)?.competitionName ?? competitionKey;
      throw new PredictionInvalidError(
        `${entries[0].raw} can't be both ${entries.map((e) => e.label).join(" and ")} ` +
          `in ${competitionName} — a club only finishes in one place.`,
        entries.map((e) => e.slotId),
      );
    }
  }
}

export class PredictionLockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PredictionLockedError";
  }
}

export interface SaveResult {
  saved: number;
  changesUsed: number;
  changesRemaining: number;
}

/**
 * Save a batch of picks.
 *
 * Before the deadline this is free editing. After it, each altered slot spends
 * from the season's change budget and is only permitted inside the January
 * window. Superseding rather than overwriting keeps "what did you originally
 * say?" answerable.
 */
export async function savePredictions(
  seasonId: string,
  playerId: string,
  values: Map<string, string>,
  now = new Date(),
): Promise<SaveResult> {
  const season = await prisma.season.findUniqueOrThrow({ where: { id: seasonId } });
  const state = toSeasonState(season, now);

  const existing = await getOwnPredictions(seasonId, playerId);

  // Validate the merged picture, not just the submitted fields: saving one slot
  // can collide with a pick made earlier in a different request.
  const merged = new Map(existing);
  for (const [slotId, value] of values) merged.set(slotId, value);
  validateDistinctPicks(merged, await getSlots(seasonId), await loadAliasIndex());

  // Only slots whose value actually differs count as changes.
  const changed = [...values.entries()].filter(
    ([slotId, value]) => (existing.get(slotId) ?? "") !== value,
  );
  if (changed.length === 0) {
    const used = await countChanges(seasonId, playerId);
    return { saved: 0, changesUsed: used, changesRemaining: season.changeBudget - used };
  }

  if (!state.isLocked) {
    await writeValues(seasonId, playerId, changed, null);
    const used = await countChanges(seasonId, playerId);
    return { saved: changed.length, changesUsed: used, changesRemaining: season.changeBudget - used };
  }

  // --- Locked: mid-season change rules apply -------------------------------
  if (!state.changeWindowOpen) {
    throw new PredictionLockedError(
      season.changeWindowStart
        ? `Predictions are locked. Changes are only allowed between ` +
          `${season.changeWindowStart.toISOString().slice(0, 10)} and ` +
          `${season.changeWindowEnd?.toISOString().slice(0, 10)}.`
        : "Predictions are locked for this season.",
    );
  }

  const used = await countChanges(seasonId, playerId);
  const cost = changeCost(changed, existing);
  if (used + cost > season.changeBudget) {
    throw new PredictionLockedError(
      `That would use ${cost} change${cost === 1 ? "" : "s"}, but only ` +
        `${season.changeBudget - used} of your ${season.changeBudget} remain.`,
    );
  }

  const change = await prisma.predictionChange.create({
    data: {
      seasonId,
      playerId,
      kind: cost < changed.length ? "SWAP" : "EDIT",
      description: describeChange(changed, existing),
    },
  });
  await writeValues(seasonId, playerId, changed, change.id);

  const nowUsed = used + cost;
  return { saved: changed.length, changesUsed: nowUsed, changesRemaining: season.changeBudget - nowUsed };
}

/**
 * A straight swap of two of the player's own picks is one change, not two —
 * per the sheet's rule: "If you are swapping 1 team with another in your list
 * (winner vs runner up) this is treated as 1 change."
 */
export function changeCost(
  changed: [string, string][],
  existing: Map<string, string>,
): number {
  const remaining = new Map(changed);
  let cost = 0;
  const consumed = new Set<string>();

  for (const [slotId, newValue] of changed) {
    if (consumed.has(slotId)) continue;
    const oldValue = existing.get(slotId) ?? "";

    // Look for a partner slot that received this slot's old value and gave up
    // the value this slot is receiving.
    const partner = [...remaining.entries()].find(
      ([otherId, otherNew]) =>
        otherId !== slotId &&
        !consumed.has(otherId) &&
        otherNew === oldValue &&
        (existing.get(otherId) ?? "") === newValue,
    );

    consumed.add(slotId);
    if (partner) consumed.add(partner[0]);
    cost += 1;
  }
  return cost;
}

function describeChange(changed: [string, string][], existing: Map<string, string>): string {
  return changed
    .map(([slotId, value]) => `${existing.get(slotId) ?? "(blank)"} -> ${value}`)
    .join("; ");
}

async function writeValues(
  seasonId: string,
  playerId: string,
  changed: [string, string][],
  changeId: string | null,
): Promise<void> {
  const slotIds = changed.map(([slotId]) => slotId);
  await prisma.$transaction([
    prisma.prediction.updateMany({
      where: { playerId, slotId: { in: slotIds }, supersededAt: null },
      data: { supersededAt: new Date() },
    }),
    prisma.prediction.createMany({
      data: changed.map(([slotId, value]) => ({ playerId, slotId, value, changeId })),
    }),
  ]);
}

export async function countChanges(seasonId: string, playerId: string): Promise<number> {
  return prisma.predictionChange.count({ where: { seasonId, playerId } });
}
