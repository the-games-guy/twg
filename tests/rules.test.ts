import { describe, expect, it } from "vitest";
import {
  scoreExactPosition,
  scoreKnockoutStage,
  scoreSetMembership,
  scoreTopScorerCount,
  scoreTopScorerPlayer,
  type RuleContext,
} from "@/lib/scoring/rules";
import {
  CHAMPIONSHIP_OVERRIDES,
  EUROPEAN_CUP_OVERRIDES,
  LEAGUE_RULESET_V1,
  resolveRule,
} from "@/lib/scoring/ruleset";
import type {
  CompetitionActuals,
  ExactPositionParams,
  KnockoutStageParams,
  SetMembershipParams,
  TopScorerCountParams,
  TopScorerPlayerParams,
} from "@/lib/scoring/types";
import { aliases, leagueActuals } from "./helpers";

const ctx = (kind: RuleContext["slotKind"], ordinal = 1): RuleContext => ({
  slotKind: kind,
  ordinal,
  aliases,
});

const positionParams = LEAGUE_RULESET_V1.LEAGUE_POSITION.params as ExactPositionParams;
const relegationParams = LEAGUE_RULESET_V1.RELEGATION.params as SetMembershipParams;
const promotionParams = LEAGUE_RULESET_V1.PROMOTION.params as SetMembershipParams;
const domesticCup = LEAGUE_RULESET_V1.CUP_WINNER.params as KnockoutStageParams;
const bootPlayer = LEAGUE_RULESET_V1.GOLDEN_BOOT_PLAYER.params as TopScorerPlayerParams;
const bootCount = LEAGUE_RULESET_V1.GOLDEN_BOOT_COUNT.params as TopScorerCountParams;

// Premier League 2025/26, reconstructed from the sheet's own point values:
//  - Arsenal 1st (3 pts to all three players)
//  - Man City 2nd (called 3rd by MC and 4th by KV, 1 pt each — only consistent
//    with a 2nd-place finish)
//  - Liverpool, Chelsea and Spurs outside the top four (0 pts)
//  - Burnley, West Ham and Wolves relegated (3 pts each); Fulham and Leeds
//    survived (0 pts)
const PL = leagueActuals([
  "Arsenal", "Manchester City", "Aston Villa", "Newcastle",
  "Liverpool", "Chelsea", "Tottenham Hotspur", "Brighton",
  "Everton", "Brentford", "Crystal Palace", "Bournemouth",
  "Nottingham Forest", "Fulham", "Leeds", "Sunderland",
  "Manchester United", "Burnley", "West Ham", "Wolves",
]);

describe("EXACT_POSITION", () => {
  it("scores 3 for the exact finishing position", () => {
    const r = scoreExactPosition("Arsenal", PL, positionParams, ctx("LEAGUE_POSITION", 1));
    expect(r.points).toBe(3);
    expect(r.status).toBe("HIT");
  });

  it("scores 1 for a top-4 club called in the wrong slot", () => {
    // The sheet's own contradiction resolved: Man City called 3rd AND 4th both
    // scored 1, which is only consistent if City finished 2nd.
    for (const slot of [3, 4]) {
      const r = scoreExactPosition("Man City", PL, positionParams, ctx("LEAGUE_POSITION", slot));
      expect(r.points, `slot ${slot}`).toBe(1);
      expect(r.status).toBe("PARTIAL");
    }
  });

  it("scores 0 outside the band, however close", () => {
    // Liverpool 5th — one place outside the top four is still nothing.
    expect(scoreExactPosition("Liverpool", PL, positionParams, ctx("LEAGUE_POSITION", 2)).points).toBe(0);
  });

  it("is exclusive, never additive", () => {
    const r = scoreExactPosition("Arsenal", PL, positionParams, ctx("LEAGUE_POSITION", 1));
    expect(r.points).not.toBe(positionParams.exactPoints + positionParams.nearPoints);
  });

  it("is untouched by the Championship's promotion override", () => {
    // CHAMPIONSHIP_OVERRIDES widens PROMOTION's near-miss band to 6, but the
    // winner (LEAGUE_POSITION) slot keeps the ordinary top-4 band. Checked
    // against history: the winner slot has paid a near-miss exactly twice
    // (West Brom 2019/20 at 2nd, Brentford 2020/21 at 3rd), both inside top 4 —
    // there is no evidence it ever reaches 5th or 6th, and the sheet scored 0
    // for both Norwich (6th) and Sunderland (4th) as winner picks.
    const rule = resolveRule(LEAGUE_RULESET_V1, CHAMPIONSHIP_OVERRIDES, "LEAGUE_POSITION");
    const params = rule.params as ExactPositionParams;
    expect(params.band).toBe(positionParams.band);
    expect(scoreExactPosition("Liverpool", PL, params, ctx("LEAGUE_POSITION", 1)).points).toBe(0);
  });

  it("does widen PROMOTION's near-miss band under the same override", () => {
    const rule = resolveRule(LEAGUE_RULESET_V1, CHAMPIONSHIP_OVERRIDES, "PROMOTION");
    const params = rule.params as SetMembershipParams;
    expect(params.nearMissBand).toBe(6);
    expect(params.nearMissPoints).toBe(1);
  });

  it("reports PENDING rather than MISS when no table exists yet", () => {
    const r = scoreExactPosition("Arsenal", { status: "PROVISIONAL" }, positionParams, ctx("LEAGUE_POSITION", 1));
    expect(r.status).toBe("PENDING");
    expect(r.points).toBe(0);
  });
});

describe("SET_MEMBERSHIP — relegation", () => {
  it("scores 3 per relegated club regardless of order", () => {
    // MC picked exactly these three in 2025/26 and scored 3+3+3.
    for (const team of ["West Ham", "Wolves", "Burnley"]) {
      expect(scoreSetMembership(team, PL, relegationParams, ctx("RELEGATION")).points, team).toBe(3);
    }
  });

  it("scores 0 for a survivor, with no consolation band", () => {
    // Tok's Fulham (14th) and KV's Leeds (15th) both scored nothing. Unlike
    // promotion, staying up near the drop earns no consolation.
    expect(scoreSetMembership("Fulham", PL, relegationParams, ctx("RELEGATION")).points).toBe(0);
    expect(scoreSetMembership("Leeds", PL, relegationParams, ctx("RELEGATION")).points).toBe(0);
    // 17th, one place above the drop.
    expect(scoreSetMembership("Manchester United", PL, relegationParams, ctx("RELEGATION")).points).toBe(0);
  });
});

describe("SET_MEMBERSHIP — Championship promotion", () => {
  const CH = leagueActuals(
    ["Coventry", "West Brom", "Middlesbrough", "Stoke", "Norwich", "Watford", "Millwall", "Swansea"],
    { playoffWinner: "Watford" },
  );
  // PROMOTION's near-miss band is Championship-specific, applied through
  // CHAMPIONSHIP_OVERRIDES rather than sitting in the base ruleset — see
  // ruleset.ts. Resolve it here the same way the engine does.
  const promotionParams = resolveRule(LEAGUE_RULESET_V1, CHAMPIONSHIP_OVERRIDES, "PROMOTION")
    .params as SetMembershipParams;

  it("scores 3 for an automatically promoted club", () => {
    expect(scoreSetMembership("Coventry", CH, promotionParams, ctx("PROMOTION")).points).toBe(3);
    expect(scoreSetMembership("West Brom", CH, promotionParams, ctx("PROMOTION")).points).toBe(3);
  });

  it("scores 3 for the play-off winner despite a 6th-place finish", () => {
    const r = scoreSetMembership("Watford", CH, promotionParams, ctx("PROMOTION"));
    expect(r.points).toBe(3);
    expect(r.status).toBe("HIT");
  });

  it("scores 1 for a top-6 finish without promotion", () => {
    const r = scoreSetMembership("Middlesbrough", CH, promotionParams, ctx("PROMOTION"));
    expect(r.points).toBe(1);
    expect(r.status).toBe("PARTIAL");
  });

  it("scores 0 for 7th", () => {
    expect(scoreSetMembership("Millwall", CH, promotionParams, ctx("PROMOTION")).points).toBe(0);
  });

  it("stays PENDING until the play-off is decided", () => {
    const midSeason: CompetitionActuals = {
      status: "PROVISIONAL",
      standings: { table: CH.standings!.table },
    };
    expect(scoreSetMembership("Coventry", midSeason, promotionParams, ctx("PROMOTION")).status).toBe("PENDING");
  });
});

describe("KNOCKOUT_STAGE", () => {
  const cup: CompetitionActuals = {
    status: "FINAL",
    cupStage: {
      winner: "Manchester City",
      runnerUp: "Chelsea",
      semiFinalists: ["Manchester City", "Chelsea", "Arsenal", "Liverpool"],
    },
  };

  it("scores a domestic cup 3/1/1", () => {
    expect(scoreKnockoutStage("Man City", cup, domesticCup, ctx("CUP_WINNER")).points).toBe(3);
    expect(scoreKnockoutStage("Chelsea", cup, domesticCup, ctx("CUP_WINNER")).points).toBe(1);
    expect(scoreKnockoutStage("Arsenal", cup, domesticCup, ctx("CUP_WINNER")).points).toBe(1);
    expect(scoreKnockoutStage("Everton", cup, domesticCup, ctx("CUP_WINNER")).points).toBe(0);
  });

  it("scores a European competition 5/3/1", () => {
    const euro = resolveRule(LEAGUE_RULESET_V1, EUROPEAN_CUP_OVERRIDES, "CUP_WINNER")
      .params as KnockoutStageParams;
    expect(scoreKnockoutStage("Man City", cup, euro, ctx("CUP_WINNER")).points).toBe(5);
    expect(scoreKnockoutStage("Chelsea", cup, euro, ctx("CUP_WINNER")).points).toBe(3);
    expect(scoreKnockoutStage("Arsenal", cup, euro, ctx("CUP_WINNER")).points).toBe(1);
  });

  it("treats a semi-finalist slot as 'reached the last four', so finalists count", () => {
    const euro = resolveRule(LEAGUE_RULESET_V1, EUROPEAN_CUP_OVERRIDES, "CUP_SEMI_FINALIST")
      .params as KnockoutStageParams;
    for (const team of ["Manchester City", "Chelsea", "Arsenal", "Liverpool"]) {
      const r = scoreKnockoutStage(team, cup, euro, ctx("CUP_SEMI_FINALIST"));
      expect(r.points, team).toBe(1);
    }
    expect(scoreKnockoutStage("Everton", cup, euro, ctx("CUP_SEMI_FINALIST")).points).toBe(0);
  });
});

describe("KNOCKOUT_STAGE — early elimination", () => {
  const midRound: CompetitionActuals = {
    status: "PROVISIONAL",
    cupStage: {
      semiFinalists: [],
      eliminated: ["Everton"],
    },
  };

  it("scores 0 as a MISS the moment a pick is marked eliminated, before the semis are even known", () => {
    const w = scoreKnockoutStage("Everton", midRound, domesticCup, ctx("CUP_WINNER"));
    expect(w.points).toBe(0);
    expect(w.status).toBe("MISS");
    expect(w.explanation).toContain("eliminated");

    const s = scoreKnockoutStage("Everton", midRound, domesticCup, ctx("CUP_SEMI_FINALIST"));
    expect(s.points).toBe(0);
    expect(s.status).toBe("MISS");
  });

  it("scores 0 as ACTIVE, not PENDING, for a pick still alive with nothing decided yet", () => {
    const w = scoreKnockoutStage("Man City", midRound, domesticCup, ctx("CUP_WINNER"));
    expect(w.points).toBe(0);
    expect(w.status).toBe("ACTIVE");

    const s = scoreKnockoutStage("Man City", midRound, domesticCup, ctx("CUP_SEMI_FINALIST"));
    expect(s.points).toBe(0);
    expect(s.status).toBe("ACTIVE");
  });

  it("still reports PENDING when there is no cup data at all", () => {
    const noData: CompetitionActuals = { status: "PROVISIONAL" };
    expect(scoreKnockoutStage("Man City", noData, domesticCup, ctx("CUP_WINNER")).status).toBe("PENDING");
  });
});

describe("TOP_SCORER_PLAYER — real-name matching", () => {
  // API-Football abbreviates first names ("E. Haaland") where football-data.org
  // gives full names ("Erling Haaland") and the sheet often just a surname.
  const boot: CompetitionActuals = {
    status: "FINAL",
    goldenBoot: { scorers: [{ player: "E. Haaland", goals: 36 }, { player: "R. Lewandowski", goals: 23 }] },
  };

  it("matches a full first name against the API's initial-only form", () => {
    // Regression: this returned 0 because neither "Erling Haaland" nor
    // "E. Haaland" is a bare surname, so the old rule called them different
    // people — silently zeroing a correct Golden Boot winner pick.
    const r = scoreTopScorerPlayer("Erling Haaland", boot, bootPlayer, ctx("GOLDEN_BOOT_PLAYER"));
    expect(r.points).toBe(3);
    expect(r.status).toBe("HIT");
  });

  it("still matches a bare surname", () => {
    expect(scoreTopScorerPlayer("Haaland", boot, bootPlayer, ctx("GOLDEN_BOOT_PLAYER")).points).toBe(3);
  });

  it("matches full-first-name against initial for a lower-ranked player too", () => {
    const r = scoreTopScorerPlayer("Robert Lewandowski", boot, bootPlayer, ctx("GOLDEN_BOOT_PLAYER"));
    expect(r.points).toBe(1); // 2nd, inside the default top-3 band
  });

  it("treats a Dutch surname prefix as part of the surname, not a first name", () => {
    // "de Jong" is one surname unit — "de" is not a first initial.
    const withDeJong: CompetitionActuals = {
      status: "FINAL",
      goldenBoot: { scorers: [{ player: "L. de Jong", goals: 8 }] },
    };
    expect(scoreTopScorerPlayer("de Jong", withDeJong, bootPlayer, ctx("GOLDEN_BOOT_PLAYER")).points).toBe(3);
    expect(scoreTopScorerPlayer("Luuk de Jong", withDeJong, bootPlayer, ctx("GOLDEN_BOOT_PLAYER")).points).toBe(3);
  });

  it("does not match a different person who happens to share a surname", () => {
    // Guards the fix: two Haalands with different first initials must not
    // collide just because the surname matches.
    const twoHaalands: CompetitionActuals = {
      status: "FINAL",
      goldenBoot: { scorers: [{ player: "E. Haaland", goals: 20 }] },
    };
    const r = scoreTopScorerPlayer("J. Haaland", twoHaalands, bootPlayer, ctx("GOLDEN_BOOT_PLAYER"));
    expect(r.points).toBe(0);
  });
});

describe("TOP_SCORER_PLAYER — ties", () => {
  // Real 2023/24 Champions League data: Kane, de Jong and Mbappe level on 8.
  const tiedForFirst: CompetitionActuals = {
    status: "FINAL",
    goldenBoot: {
      scorers: [
        { player: "H. Kane", goals: 8 },
        { player: "L. de Jong", goals: 8 },
        { player: "Kylian Mbappe", goals: 8 },
        { player: "Vinicius Junior", goals: 6 },
      ],
    },
  };

  it("credits every player tied for the lead as a full winner, not by array position", () => {
    // Regression: Mbappe sits at array index 2. The old rule read that
    // position literally and scored him as "3rd" (1 point) despite being
    // level with the actual leader on goals — the real sheet, and the real
    // competition, credited this as a shared Golden Boot win (3 points).
    for (const name of ["Kane", "de Jong", "Mbappe"]) {
      const r = scoreTopScorerPlayer(name, tiedForFirst, bootPlayer, ctx("GOLDEN_BOOT_PLAYER"));
      expect(r.points, name).toBe(3);
      expect(r.status).toBe("HIT");
    }
  });

  it("says who the Golden Boot was shared with", () => {
    const r = scoreTopScorerPlayer("Mbappe", tiedForFirst, bootPlayer, ctx("GOLDEN_BOOT_PLAYER"));
    expect(r.explanation).toContain("sharing it with 2");
  });

  it("credits the very next tier below a leading tie, not just the leaders", () => {
    // Only one tier (the 8s) sits above Vinicius's 6, so he is genuinely 2nd
    // by tier, inside a top-3 band — this is the same mechanic the Haaland
    // case below exercises with the real full chart.
    const r = scoreTopScorerPlayer("Vinicius Junior", tiedForFirst, bootPlayer, ctx("GOLDEN_BOOT_PLAYER"));
    expect(r.points).toBe(1);
    expect(r.explanation).toContain("2nd");
  });

  it("ranks a tier below the leaders by tier count, not player count", () => {
    // The real 2023/24 UCL chart: Kane/de Jong/Mbappe level on 8, then
    // Haaland/Vinicius level on 6 — one tier below the leaders, genuinely 2nd
    // by goal tier. Ranking by player count instead would put Haaland 4th
    // (three individuals ahead) and outside a top-3 band; the sheet credited
    // this pick with the top-3 consolation point, which only holds under
    // tier-based ranking.
    const realShape: CompetitionActuals = {
      status: "FINAL",
      goldenBoot: {
        scorers: [
          { player: "H. Kane", goals: 8 },
          { player: "L. de Jong", goals: 8 },
          { player: "Kylian Mbappe", goals: 8 },
          { player: "E. Haaland", goals: 6 },
          { player: "Vinicius Junior", goals: 6 },
        ],
      },
    };
    const r = scoreTopScorerPlayer("Haaland", realShape, bootPlayer, ctx("GOLDEN_BOOT_PLAYER"));
    expect(r.points).toBe(1);
    expect(r.explanation).toContain("2nd"); // one tier (the 8s) above him
  });

  it("still excludes a tier that is genuinely outside the band", () => {
    const fourTiersDeep: CompetitionActuals = {
      status: "FINAL",
      goldenBoot: {
        scorers: [
          { player: "A", goals: 10 },
          { player: "B", goals: 9 },
          { player: "C", goals: 8 },
          { player: "D", goals: 7 }, // 4th distinct tier — outside a top-3 band
        ],
      },
    };
    const r = scoreTopScorerPlayer("D", fourTiersDeep, bootPlayer, ctx("GOLDEN_BOOT_PLAYER"));
    expect(r.points).toBe(0);
    expect(r.explanation).toContain("4th");
  });
});

describe("TOP_SCORER_PLAYER", () => {
  const boot: CompetitionActuals = {
    status: "FINAL",
    goldenBoot: {
      scorers: [
        { player: "Erling Haaland", goals: 27 },
        { player: "Alexander Isak", goals: 24 },
        { player: "Mohamed Salah", goals: 22 },
        { player: "Bukayo Saka", goals: 19 },
      ],
    },
  };

  it("scores 3 for the winner, matching a bare surname", () => {
    expect(scoreTopScorerPlayer("Haaland", boot, bootPlayer, ctx("GOLDEN_BOOT_PLAYER")).points).toBe(3);
  });

  it("scores 1 inside the top 3 and 0 at 4th", () => {
    expect(scoreTopScorerPlayer("Salah", boot, bootPlayer, ctx("GOLDEN_BOOT_PLAYER")).points).toBe(1);
    expect(scoreTopScorerPlayer("Saka", boot, bootPlayer, ctx("GOLDEN_BOOT_PLAYER")).points).toBe(0);
  });
});

describe("TOP_SCORER_COUNT", () => {
  // Premier League 2025/26: the sheet records the actual tally as 27 in column H.
  const boot: CompetitionActuals = {
    status: "FINAL",
    goldenBoot: { scorers: [{ player: "Erling Haaland", goals: 27 }] },
  };

  it("scores 3 only for the exact tally", () => {
    expect(scoreTopScorerCount("27", boot, bootCount, ctx("GOLDEN_BOOT_COUNT")).points).toBe(3);
  });

  it("scores 1 at exactly the tolerance and 0 one goal beyond", () => {
    expect(scoreTopScorerCount("24", boot, bootCount, ctx("GOLDEN_BOOT_COUNT")).points).toBe(1);
    expect(scoreTopScorerCount("30", boot, bootCount, ctx("GOLDEN_BOOT_COUNT")).points).toBe(1);
    expect(scoreTopScorerCount("23", boot, bootCount, ctx("GOLDEN_BOOT_COUNT")).points).toBe(0);
    expect(scoreTopScorerCount("31", boot, bootCount, ctx("GOLDEN_BOOT_COUNT")).points).toBe(0);
  });

  it("reproduces the 2025/26 Premier League golden-boot column", () => {
    // KV 24, MC 25, Tok 26 against an actual of 27 — all three scored 1.
    for (const guess of ["24", "25", "26"]) {
      expect(scoreTopScorerCount(guess, boot, bootCount, ctx("GOLDEN_BOOT_COUNT")).points).toBe(1);
    }
  });

  it("applies the tournament tolerance of 1 when overridden", () => {
    const tight = { ...bootCount, tolerance: 1 };
    expect(scoreTopScorerCount("26", boot, tight, ctx("GOLDEN_BOOT_COUNT")).points).toBe(1);
    expect(scoreTopScorerCount("25", boot, tight, ctx("GOLDEN_BOOT_COUNT")).points).toBe(0);
  });
});

describe("team name display", () => {
  it("shows a known club by its canonical spelling", () => {
    // "Man City" is an alias; explanations should say "Manchester City".
    const r = scoreExactPosition("Man City", PL, positionParams, ctx("LEAGUE_POSITION", 2));
    expect(r.explanation).toContain("Manchester City");
    expect(r.explanation).not.toContain("man city");
  });

  it("echoes an unknown club exactly as typed, not lowercased", () => {
    // Regression: resolveTeam used to fall back to the normalised (lowercased)
    // form, producing "arsenal finished 1st exactly as predicted".
    const r = scoreExactPosition("Arsenal", PL, positionParams, ctx("LEAGUE_POSITION", 1));
    expect(r.explanation).toContain("Arsenal finished 1st");
  });

  it("still matches two unknown spellings of the same club", () => {
    const r = scoreExactPosition("nottingham forest", PL, positionParams, ctx("LEAGUE_POSITION", 1));
    expect(r.status).toBe("MISS");
    expect(r.explanation).toContain("13th");
  });
});

describe("naming your winner among your own semi-finalists", () => {
  const cup: CompetitionActuals = {
    status: "FINAL",
    cupStage: {
      winner: "PSG",
      runnerUp: "Arsenal",
      semiFinalists: ["PSG", "Arsenal", "Bayern Munich", "Real Madrid"],
    },
  };
  const euroWinner = resolveRule(LEAGUE_RULESET_V1, EUROPEAN_CUP_OVERRIDES, "CUP_WINNER")
    .params as KnockoutStageParams;
  const euroSemi = resolveRule(LEAGUE_RULESET_V1, EUROPEAN_CUP_OVERRIDES, "CUP_SEMI_FINALIST")
    .params as KnockoutStageParams;

  it("pays both slots when the club goes all the way", () => {
    // The safe double: 5 for calling the winner, plus 1 for the semi-final slot
    // they also occupy.
    const w = scoreKnockoutStage("PSG", cup, euroWinner, ctx("CUP_WINNER"));
    const s = scoreKnockoutStage("PSG", cup, euroSemi, ctx("CUP_SEMI_FINALIST"));
    expect(w.points).toBe(5);
    expect(s.points).toBe(1);
    expect(w.points + s.points).toBe(6);
  });

  it("still pays both when the club only reaches the semis", () => {
    // Bayern lost the semi-final: the winner slot pays its 1-point consolation
    // and the semi-final slot pays too.
    const w = scoreKnockoutStage("Bayern Munich", cup, euroWinner, ctx("CUP_WINNER"));
    const s = scoreKnockoutStage("Bayern Munich", cup, euroSemi, ctx("CUP_SEMI_FINALIST"));
    expect(w.points).toBe(1);
    expect(s.points).toBe(1);
  });

  it("pays nothing twice when the club goes out early", () => {
    // The cost of the strategy: one of the four coverage spots is spent, and
    // both slots are dead. This is what happened to Tok's Liverpool in 2025/26.
    const w = scoreKnockoutStage("Liverpool", cup, euroWinner, ctx("CUP_WINNER"));
    const s = scoreKnockoutStage("Liverpool", cup, euroSemi, ctx("CUP_SEMI_FINALIST"));
    expect(w.points).toBe(0);
    expect(s.points).toBe(0);
  });

  it("beats spreading across four clubs only if the pick is right", () => {
    // Coverage alternative: four different clubs, two of which got there.
    const spread = ["Bayern Munich", "Real Madrid", "Inter", "Chelsea"]
      .map((t) => scoreKnockoutStage(t, cup, euroSemi, ctx("CUP_SEMI_FINALIST")).points)
      .reduce((a, b) => a + b, 0);
    expect(spread).toBe(2);
  });
});
