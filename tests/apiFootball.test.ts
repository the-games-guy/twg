/**
 * The top-scorer response needs interpreting, not just reading. These cases are
 * taken from real API responses.
 */

import { describe, expect, it } from "vitest";
import { leagueGoals } from "@/lib/results/apiFootball";

const LA_LIGA = 140;

const entry = (leagueId: number, goals: number | null) => ({
  league: { id: leagueId },
  goals: { total: goals },
});

describe("leagueGoals", () => {
  it("reads a single clean entry", () => {
    expect(leagueGoals([entry(LA_LIGA, 23)], LA_LIGA)).toBe(23);
  });

  it("collapses a duplicated row rather than doubling it", () => {
    // Real response: Sørloth's 2022/23 La Liga season is listed twice, once
    // against Real Sociedad and once against Atletico Madrid, both showing 12.
    // Summing made him Pichichi on 24, ahead of Lewandowski's actual 23.
    expect(leagueGoals([entry(LA_LIGA, 12), entry(LA_LIGA, 12)], LA_LIGA)).toBe(12);
  });

  it("adds a genuine mid-season transfer, where the totals differ", () => {
    expect(leagueGoals([entry(LA_LIGA, 8), entry(LA_LIGA, 7)], LA_LIGA)).toBe(15);
  });

  it("ignores goals scored in other competitions", () => {
    // Cup and European goals must not inflate a domestic golden boot.
    expect(leagueGoals([entry(LA_LIGA, 23), entry(2, 12), entry(143, 4)], LA_LIGA)).toBe(23);
  });

  it("treats a null total as zero", () => {
    expect(leagueGoals([entry(LA_LIGA, null)], LA_LIGA)).toBe(0);
  });

  it("returns zero when the player has no entry for this league", () => {
    expect(leagueGoals([entry(2, 12)], LA_LIGA)).toBe(0);
  });

  it("keeps the real Pichichi ahead of the duplicated player", () => {
    const lewandowski = leagueGoals([entry(LA_LIGA, 23)], LA_LIGA);
    const sorloth = leagueGoals([entry(LA_LIGA, 12), entry(LA_LIGA, 12)], LA_LIGA);
    expect(lewandowski).toBeGreaterThan(sorloth);
  });
});
