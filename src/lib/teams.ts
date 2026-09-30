/**
 * Club name canonicalisation.
 *
 * Three sources disagree about what a club is called: the workbook ("Juve",
 * "Atletic Bilbao", "Portgual"), football-data.org ("Manchester City FC"), and
 * whatever a player types. Everything funnels through normalise() and then an
 * alias lookup, so comparisons are made on canonical names only.
 */

const NOISE_WORDS = new Set([
  "fc", "cf", "afc", "ac", "as", "ss", "ssc", "sc", "us", "ud", "rc", "rcd",
  "cd", "sd", "club", "calcio", "de", "futbol", "football",
]);

/** Lowercase, strip accents and punctuation, drop club-type noise words. */
/**
 * "Utd" and "United" are the same word to every English football fan
 * ("Sheffield Utd" in API-Football's own data, "Sheffield United" in the
 * sheet), so this is folded into normalisation itself rather than left to be
 * hand-curated per club.
 */
const WORD_EQUIVALENTS: Record<string, string> = { utd: "united" };

export function normalise(raw: string): string {
  const stripped = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const words = stripped.split(" ").map((w) => WORD_EQUIVALENTS[w] ?? w);
  const kept = words.filter((w) => !NOISE_WORDS.has(w));
  // Never normalise a name out of existence — "AC" alone stays "ac".
  return (kept.length ? kept : words).join(" ");
}

export interface AliasIndex {
  /** normalised alias -> canonical name */
  lookup: Map<string, string>;
}

export function buildAliasIndex(
  entries: { alias: string; canonical: string }[],
): AliasIndex {
  const lookup = new Map<string, string>();
  for (const { alias, canonical } of entries) {
    lookup.set(normalise(alias), canonical);
    // A canonical name is always an alias of itself.
    lookup.set(normalise(canonical), canonical);
  }
  return { lookup };
}

/**
 * Comparison key for a club name. Known spellings collapse onto their canonical
 * name; unknown ones fall back to their normalised form so two spellings of a
 * club we've never seen still match each other.
 *
 * Use this rather than normalise() wherever two user-supplied names must be
 * compared — normalise() alone does not know that "Man City" and
 * "Manchester City FC" are one club.
 */
export function teamKey(index: AliasIndex, raw: string): string {
  const n = normalise(raw);
  return index.lookup.get(n) ?? n;
}

/**
 * The name to show a human.
 *
 * Returns the canonical spelling when we know the club, and otherwise the text
 * exactly as it was entered — never the normalised form, which is lowercased
 * and would render explanations as "arsenal finished 1st".
 */
export function resolveTeam(index: AliasIndex, raw: string): string {
  if (!raw) return "";
  return index.lookup.get(normalise(raw)) ?? raw.trim();
}

export function isKnownTeam(index: AliasIndex, raw: string): boolean {
  return index.lookup.has(normalise(raw));
}

/** Comparison used everywhere in scoring. */
export function sameTeam(index: AliasIndex, a: string, b: string): boolean {
  if (!a || !b) return false;
  return teamKey(index, a) === teamKey(index, b);
}

/** Player names get the same treatment minus the club-noise stripping. */
export function normalisePerson(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Particles that are part of a surname, not a first name — "L. de Jong" is
 * not "de" as a first initial and "Jong" as the surname, it's "de Jong" as a
 * single unit. Real case: the 2023/24 Champions League Golden Boot data
 * returns exactly "L. de Jong".
 */
const SURNAME_PREFIXES = new Set([
  "de", "van", "der", "den", "von", "di", "da", "dos", "das", "la", "le", "el", "al", "bin",
]);

/** Splits a normalised name into (leading tokens, surname unit). */
function splitSurname(parts: string[]): { lead: string[]; surname: string } {
  let cut = parts.length - 1;
  while (cut > 0 && SURNAME_PREFIXES.has(parts[cut - 1])) cut -= 1;
  return { lead: parts.slice(0, cut), surname: parts.slice(cut).join(" ") };
}

/**
 * The workbook records surnames only ("Salah", "Mbappe", "Martinez") while
 * football-data.org returns full names ("Mohamed Salah") and API-Football
 * abbreviates the first name to an initial ("E. Haaland", "R. Lewandowski").
 * Three forms of the same person, all seen in real data for the same slot.
 *
 * Regression: "Erling Haaland" (a prediction) failed to match "E. Haaland"
 * (API-Football's scorer name) because neither side is a bare surname, so the
 * old rule fell through to "different people". That silently zeroed a correct
 * Golden Boot pick.
 */
export function samePerson(a: string, b: string): boolean {
  const na = normalisePerson(a);
  const nb = normalisePerson(b);
  if (!na || !nb) return false;
  if (na === nb) return true;

  const { lead: leadA, surname: surnameA } = splitSurname(na.split(" "));
  const { lead: leadB, surname: surnameB } = splitSurname(nb.split(" "));
  if (surnameA !== surnameB) return false;

  // A bare surname ("Salah", "de Jong") matches anyone with that surname.
  if (leadA.length === 0 || leadB.length === 0) return true;

  // One side reduced to an initial ("E. Haaland") — same surname plus a
  // matching first initial is enough; the full first name need not line up.
  const firstA = leadA[0];
  const firstB = leadB[0];
  if (firstA.length === 1 || firstB.length === 1) return firstA[0] === firstB[0];

  return false;
}
