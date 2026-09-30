/**
 * The Monday digest.
 *
 * Reports movement rather than a bare table: a leaderboard that has not changed
 * is not news, so a week with no scoring changes says so in one line instead of
 * reposting identical standings.
 */

import { prisma } from "@/lib/db";
import { buildActiveLeaderboard } from "@/lib/reports/leaderboard";
import { formatLeaderboard } from "@/lib/reports/digest";

const SNAPSHOT_KEY = "digest-totals";

async function readSnapshot(seasonId: string): Promise<Record<string, number> | null> {
  const row = await prisma.snapshot.findFirst({
    where: { seasonId, key: SNAPSHOT_KEY },
    orderBy: { createdAt: "desc" },
  });
  if (!row) return null;
  try {
    return JSON.parse(row.payload) as Record<string, number>;
  } catch {
    return null;
  }
}

async function writeSnapshot(seasonId: string, totals: Record<string, number>): Promise<void> {
  await prisma.snapshot.create({
    data: { seasonId, key: SNAPSHOT_KEY, payload: JSON.stringify(totals) },
  });
}

export async function buildWeeklyDigest(): Promise<string | null> {
  const board = await buildActiveLeaderboard();
  if (!board) return null;
  if (!board.isLocked) return null; // Nothing to report while entry is open.

  const totals: Record<string, number> = {};
  for (const row of board.rows) totals[row.playerHandle] = row.total;

  const previous = await readSnapshot(board.seasonId);
  await writeSnapshot(board.seasonId, totals);

  if (!previous) return formatLeaderboard(board);

  const moved = Object.entries(totals).filter(([h, v]) => (previous[h] ?? 0) !== v);
  if (moved.length === 0) {
    return `📊 ${board.seasonLabel} — no change this week. ${board.rows
      .map((r) => `${r.playerHandle} ${r.total}`)
      .join(" · ")}`;
  }

  const deltas = moved
    .map(([h, v]) => {
      const d = v - (previous[h] ?? 0);
      return `${h} ${d > 0 ? "+" : ""}${d}`;
    })
    .join(", ");

  return `${formatLeaderboard(board)}\n\nThis week: ${deltas}.`;
}
