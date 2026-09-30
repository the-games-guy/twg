import { NextResponse } from "next/server";
import { requirePlayer } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * All known team names, for predictive search on TEAM prediction slots.
 *
 * Not scoped to a competition: Team.competitionId isn't reliably populated
 * (most rows come from historical import, not the football-data.org sync),
 * and scoring itself never scopes by competition either — see teamIndex.ts,
 * which builds one global alias index. Suggesting the full list keeps this
 * consistent with how a pick actually gets matched.
 */
export async function GET() {
  try {
    await requirePlayer();
  } catch {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const teams = await prisma.team.findMany({
    select: { name: true },
    orderBy: { name: "asc" },
  });

  return NextResponse.json({ teams: teams.map((t) => t.name) });
}
