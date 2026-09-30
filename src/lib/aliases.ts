/**
 * Spellings the group actually uses, harvested from the workbook.
 *
 * The results sync populates aliases from football-data.org, but that only
 * covers competitions the API serves and only after a first sync. These seed
 * the gap so duplicate-pick validation works from day one, and so historical
 * imports resolve to the same clubs as live data.
 */

export const SEED_ALIASES: { alias: string; canonical: string }[] = [
  // England
  { alias: "Man City", canonical: "Manchester City" },
  { alias: "Man Utd", canonical: "Manchester United" },
  { alias: "Man United", canonical: "Manchester United" },
  { alias: "Spurs", canonical: "Tottenham Hotspur" },
  { alias: "Tottenham", canonical: "Tottenham Hotspur" },
  { alias: "Wolves", canonical: "Wolverhampton Wanderers" },
  { alias: "Newcastle", canonical: "Newcastle United" },
  { alias: "West Brom", canonical: "West Bromwich Albion" },
  { alias: "Forest", canonical: "Nottingham Forest" },
  { alias: "Brighton", canonical: "Brighton & Hove Albion" },
  { alias: "Leeds", canonical: "Leeds United" },
  { alias: "Leicester", canonical: "Leicester City" },
  { alias: "Boro", canonical: "Middlesbrough" },

  // Spain
  { alias: "Barca", canonical: "Barcelona" },
  { alias: "Atletico", canonical: "Atletico Madrid" },
  { alias: "Athletic Club", canonical: "Athletic Bilbao" },
  { alias: "Bilbao", canonical: "Athletic Bilbao" },
  { alias: "Atletic Bilbao", canonical: "Athletic Bilbao" },
  { alias: "Villareal", canonical: "Villarreal" },
  { alias: "Betis", canonical: "Real Betis" },

  // Italy
  { alias: "Juve", canonical: "Juventus" },
  { alias: "Inter Milan", canonical: "Inter" },
  { alias: "Internazionale", canonical: "Inter" },
  { alias: "Milan", canonical: "AC Milan" },
  { alias: "Napoli", canonical: "Napoli" },

  // Germany
  { alias: "Bayern", canonical: "Bayern Munich" },
  { alias: "Dortmund", canonical: "Borussia Dortmund" },
  { alias: "BVB", canonical: "Borussia Dortmund" },
  { alias: "Leverkusen", canonical: "Bayer Leverkusen" },
  { alias: "Frankfurt", canonical: "Eintracht Frankfurt" },
  { alias: "Mainz", canonical: "FSV Mainz 05" },
  { alias: "M'gladbach", canonical: "Borussia Monchengladbach" },
  { alias: "Gladbach", canonical: "Borussia Monchengladbach" },
  { alias: "Monchengladbach", canonical: "Borussia Monchengladbach" },
  { alias: "Koln", canonical: "1.FC Koln" },
  { alias: "Cologne", canonical: "1.FC Koln" },
  { alias: "Hoffenheim", canonical: "1899 Hoffenheim" },
  { alias: "Schalke", canonical: "FC Schalke 04" },
  { alias: "Wolfsburg", canonical: "VfL Wolfsburg" },
  { alias: "Bochum", canonical: "VfL Bochum" },
  { alias: "Stuttgart", canonical: "VfB Stuttgart" },
  { alias: "Freiburg", canonical: "SC Freiburg" },
  { alias: "Augsburg", canonical: "FC Augsburg" },
  { alias: "Hertha", canonical: "Hertha Berlin" },

  // England — shorthand and common misspellings seen in the sheet
  { alias: "Blackburn", canonical: "Blackburn Rovers" },
  { alias: "Ipswitch", canonical: "Ipswich Town" }, // sheet typo, kept for import fidelity
  { alias: "Ipswich", canonical: "Ipswich Town" },

  // Spain — misspelling variant seen in the sheet, beyond the "Atletic Bilbao"
  // alias already covering the other typo
  { alias: "Atletico Bilbao", canonical: "Athletic Bilbao" },

  // Misspellings and shorthand found in picks across all seasons
  { alias: "Ateltico Madrid", canonical: "Atletico Madrid" },
  { alias: "Athletico Madrid", canonical: "Atletico Madrid" },
  { alias: "Real Mardid", canonical: "Real Madrid" },
  { alias: "RM", canonical: "Real Madrid" },
  { alias: "Seville", canonical: "Sevilla" },
  { alias: "Brenford", canonical: "Brentford" },
  { alias: "Burnely", canonical: "Burnley" },
  { alias: "Hull", canonical: "Hull City" },
  { alias: "Feyornoord", canonical: "Feyenoord" },
  { alias: "Coventry", canonical: "Coventry City" },
  { alias: "Preston", canonical: "Preston North End" },
  { alias: "Derby", canonical: "Derby County" },
  { alias: "Como", canonical: "Como 1907" },

  // football-data.org's Champions League names that don't normalise onto ours
  { alias: "FC Bayern München", canonical: "Bayern Munich" },

  // Europe
  { alias: "Paris Saint-Germain", canonical: "PSG" },
  { alias: "Paris SG", canonical: "PSG" },
  { alias: "Sporting", canonical: "Sporting CP" },
];
