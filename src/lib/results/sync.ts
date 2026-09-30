/**
 * Pull results for every competition in a season that the API can serve, and
 * record them as ActualResult rows.
 *
 * Runs repeatedly through the season: each pass overwrites the previous
 * PROVISIONAL snapshot, and flips to FINAL once every fixture is played. That
 * is what makes a mid-season leaderboard possible at all — something the
 * spreadsheet could never do, because it never stored results.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  FootballDataError,
  fetchCupStage,
  fetchGoldenBoot,
  fetchStandings,
  isCompetitionFinished,
  type FetchedTeam,
} from "./footballData";
import { normalise } from "@/lib/teams";

export interface SyncReport {
  seasonLabel: string;
  updated: string[];
  skipped: { competition: string; reason: string }[];
  failed: { competition: string; error: string }[];
}

/**
 * Find a Team already known under any spelling of this club, via TeamAlias —
 * not via Team.name. A club seeded as "Manchester City" that the API calls
 * "Manchester City FC" would otherwise fail a name-keyed lookup and fork into
 * a second Team row, splitting the alias graph so some spellings of the same
 * club (e.g. "Man City") stop matching the club's own standings-table entry.
 */
async function resolveExistingTeam(t: FetchedTeam): Promise<{ id: string } | null> {
  const variants = [t.name, t.shortName, t.tla].filter(Boolean) as string[];
  for (const variant of variants) {
    const alias = normalise(variant);
    if (!alias) continue;
    const existing = await prisma.teamAlias.findUnique({ where: { alias } });
    if (existing) return { id: existing.teamId };
  }
  return null;
}

/**
 * Every row this club is already known under by full name or short name. TLAs
 * are left out: they collide across leagues (Millwall and AC Milan are both
 * "MIL"), so a TLA match isn't evidence two rows are the same club.
 */
async function rowsKnownByName(t: FetchedTeam) {
  const rows = new Map<string, { id: string; providerId: number | null }>();
  for (const variant of [t.name, t.shortName]) {
    const alias = variant ? normalise(variant) : "";
    if (!alias) continue;
    const existing = await prisma.teamAlias.findUnique({ where: { alias }, include: { team: true } });
    if (existing) rows.set(existing.team.id, { id: existing.team.id, providerId: existing.team.providerId });
  }
  return [...rows.values()];
}

/** TeamAlias is the only thing that references a Team row, so re-point it and drop the duplicate. */
async function mergeTeamInto(fromId: string, intoId: string): Promise<void> {
  await prisma.teamAlias.updateMany({ where: { teamId: fromId }, data: { teamId: intoId } });
  await prisma.team.delete({ where: { id: fromId } });
}

/**
 * Keep canonical club names and their spelling variants in step with the API.
 *
 * Keyed by `name`, not `providerId` — `name` is the field every other Team
 * row in this app is keyed by (the historical-import scripts have never known
 * about `providerId`, since it's specific to football-data.org), and it's the
 * field the scoring engine actually resolves against. Upserting by
 * `providerId` here left it out of step with everything else: whenever the
 * live sync met a club the historical import already knew (created with
 * `providerId: null`), the providerId lookup found nothing, tried to CREATE a
 * second row, and hit the `name` unique constraint — crashing that
 * competition's sync outright, not just logging a conflict.
 */
async function upsertTeam(t: FetchedTeam, competitionId: string) {
  const update = { providerId: t.providerId, shortName: t.shortName, competitionId };

  // Prefer a club already known by alias over matching Team.name exactly, so
  // a name string the API spells differently from the seed/import data
  // reuses the existing row instead of forking a duplicate.
  const known = await resolveExistingTeam(t);
  const holder = await prisma.team.findUnique({ where: { providerId: t.providerId } });
  if (known) {
    // Syncs from before alias resolution forked clubs into a second row: e.g.
    // "Coventry City FC" (full name) alongside a seeded "Coventry" (the API's
    // short name), each holding some of the club's spellings, so picks and
    // the table resolved to different rows. Fold every such row into `known`.
    // The providerId holder is the same club by definition — and left in
    // place, setting the providerId on `known` would hit the unique
    // constraint and fail the whole competition. A name-matched row already
    // carrying a different providerId is a different club, so it's left alone.
    const forks = new Set<string>();
    if (holder && holder.id !== known.id) forks.add(holder.id);
    for (const row of await rowsKnownByName(t)) {
      if (row.id !== known.id && (row.providerId === null || row.providerId === t.providerId)) forks.add(row.id);
    }
    for (const id of forks) {
      await mergeTeamInto(id, known.id);
      console.log(`merged a duplicate team row into "${t.name}"`);
    }
    return prisma.team.update({ where: { id: known.id }, data: update });
  }
  // The API renamed a club we already hold under its providerId.
  if (holder) {
    return prisma.team.update({ where: { id: holder.id }, data: update });
  }

  const where = { name: t.name };
  try {
    return await prisma.team.upsert({
      where,
      update,
      create: { providerId: t.providerId, name: t.name, shortName: t.shortName, competitionId },
    });
  } catch (e) {
    // The worker (scheduled/startup syncs) and the web app (the admin's
    // "sync now" button) are separate processes sharing one SQLite file, so
    // two syncs can race: both see no existing row and both try to CREATE,
    // and the loser hits this constraint instead of the row it should have
    // just updated. By the time that happens the row exists, so retrying as
    // a plain update resolves it — no need to fail the whole competition.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return prisma.team.update({ where, data: update });
    }
    throw e;
  }
}

async function upsertTeams(teams: FetchedTeam[], competitionId: string): Promise<void> {
  for (const t of teams) {
    const team = await upsertTeam(t, competitionId);

    // "Manchester City FC", "Man City" and "MCI" all resolve to one club.
    const variants = [t.name, t.shortName, t.tla].filter(Boolean) as string[];
    for (const variant of variants) {
      const alias = normalise(variant);
      if (!alias) continue;
      const existing = await prisma.teamAlias.findUnique({ where: { alias } });
      if (existing) {
        if (existing.teamId !== team.id) {
          // Two clubs claiming one alias: leave the first owner in place rather
          // than silently repointing it, and let the admin sort it out.
          console.warn(`alias conflict: "${alias}" already maps elsewhere`);
        }
        continue;
      }
      await prisma.teamAlias.create({ data: { alias, teamId: team.id } });
    }
  }
}

async function record(
  seasonCompetitionId: string,
  kind: "STANDINGS" | "CUP_STAGE" | "GOLDEN_BOOT",
  payload: unknown,
  status: "PROVISIONAL" | "FINAL",
): Promise<void> {
  await prisma.actualResult.upsert({
    where: { seasonCompetitionId_kind: { seasonCompetitionId, kind } },
    update: { payload: JSON.stringify(payload), status, source: "football-data", fetchedAt: new Date() },
    create: {
      seasonCompetitionId,
      kind,
      payload: JSON.stringify(payload),
      status,
      source: "football-data",
    },
  });
}

export async function syncSeasonResults(seasonId: string): Promise<SyncReport> {
  const season = await prisma.season.findUniqueOrThrow({
    where: { id: seasonId },
    include: {
      competitions: { include: { competition: true, slots: true } },
    },
  });

  const report: SyncReport = {
    seasonLabel: season.label,
    updated: [],
    skipped: [],
    failed: [],
  };

  for (const sc of season.competitions) {
    const { competition } = sc;
    const name = competition.name;

    if (!competition.providerCode) {
      report.skipped.push({ competition: name, reason: "manual entry only" });
      continue;
    }

    // Only fetch what this competition is actually asked to predict.
    const kinds = new Set(sc.slots.map((s) => s.kind));
    const wantsTable = kinds.has("LEAGUE_POSITION") || kinds.has("RELEGATION") || kinds.has("PROMOTION");
    const wantsBoot = kinds.has("GOLDEN_BOOT_PLAYER") || kinds.has("GOLDEN_BOOT_COUNT");
    const wantsCup = kinds.has("CUP_WINNER") || kinds.has("CUP_SEMI_FINALIST");

    try {
      const finished = await isCompetitionFinished(competition.providerCode, season.startYear);
      const status = finished ? "FINAL" : "PROVISIONAL";

      if (wantsTable) {
        const { payload, teams } = await fetchStandings(competition.providerCode, season.startYear);
        await upsertTeams(teams, competition.id);
        // The play-off winner is not in any API table; preserve whatever the
        // admin entered rather than clobbering it on every sync.
        const existing = await prisma.actualResult.findUnique({
          where: { seasonCompetitionId_kind: { seasonCompetitionId: sc.id, kind: "STANDINGS" } },
        });
        if (existing) {
          const prev = JSON.parse(existing.payload) as { playoffWinner?: string };
          if (prev.playoffWinner) payload.playoffWinner = prev.playoffWinner;
        }
        await record(sc.id, "STANDINGS", payload, status);
      }

      if (wantsCup) {
        const payload = await fetchCupStage(competition.providerCode, season.startYear);
        await record(sc.id, "CUP_STAGE", payload, status);
      }

      if (wantsBoot) {
        const payload = await fetchGoldenBoot(competition.providerCode, season.startYear);
        await record(sc.id, "GOLDEN_BOOT", payload, status);
      }

      report.updated.push(`${name} (${status.toLowerCase()})`);
    } catch (e) {
      // A brand-new season/competition (e.g. the Champions League league
      // phase, whose fixtures aren't published until the August draw) 404s
      // on football-data.org until they create it upstream. That's not a
      // failure of this sync, just nothing to fetch yet — treat it like the
      // existing "manual entry only" case rather than alarming as a failure.
      if (e instanceof FootballDataError && e.status === 404) {
        report.skipped.push({ competition: name, reason: "season not yet published by football-data.org" });
        continue;
      }
      const message = e instanceof FootballDataError ? e.message : String(e);
      report.failed.push({ competition: name, error: message });
    }
  }

  return report;
}

export async function syncActiveSeason(): Promise<SyncReport | null> {
  const season = await prisma.season.findFirst({
    where: { isActive: true },
    orderBy: { startYear: "desc" },
  });
  if (!season) return null;
  return syncSeasonResults(season.id);
}
