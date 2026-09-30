# TWG Comp

Season prediction competition, replacing `TWG Comp.xlsx`.

Three things the spreadsheet could not do:

- **Blind entry.** Each player sees only their own picks until the deadline. In the sheet everyone's predictions sat in adjacent columns, so whoever filled it in last had an advantage.
- **Computed scoring.** Points come from a rules engine fed by real results. Every `Points` cell in the workbook was typed by hand, and [three of them were wrong](#known-spreadsheet-errors).
- **Live standings.** The sheet never recorded what actually happened, so a mid-season leaderboard was impossible. The in-app leaderboard now auto-refreshes for anyone with it open — see [How scoring works](#how-scoring-works).

## Quick start

```bash
npm install
cp .env.example .env          # then fill it in — see Registration below for Google OAuth
npx prisma db push
npm run seed
npm run dev
```

Register each player's Google account (Admin → Registration) before they try to sign in — see [Registration and sign-in](#registration-and-sign-in).

## Registration and sign-in

There is no self-serve signup and no email infrastructure to run — no verification emails, no password-reset emails. A player's identity is one email address, and "registering" someone is the admin recording that email against their `Player` row in Admin → Registration. That's the entire registration step, regardless of which of the two sign-in methods a player then uses.

### Google

**One-time setup**, in the [Google Cloud Console](https://console.cloud.google.com/apis/credentials):

1. Create an OAuth 2.0 Client ID, type "Web application".
2. Add an authorized redirect URI of exactly `{APP_ORIGIN}/api/auth/google/callback` — for local dev that's `http://localhost:3000/api/auth/google/callback`.
3. Put the client ID and secret in `.env` as `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.

Once a player's email is registered, they click "Sign in with Google" and are in if their Google account's (verified) email matches. Nothing to distribute, nothing to lose.

**Why not next-auth (Auth.js)?** It's the standard choice, but its v5 has been in beta for years with no stable release — a real risk to take on as the thing standing between the internet and everyone's predictions in an app meant to run for years. For one provider and three known users, the actual OAuth surface is small enough to own directly (`src/lib/googleAuth.ts`): a standard PKCE authorization-code flow, state-checked against CSRF, with the one genuinely dangerous part — verifying the signed ID token's signature, audience and issuer — done by Google's own maintained `google-auth-library`, not hand-rolled crypto.

### Email and password

For anyone who'd rather not use Google. In Admin → Registration, once a player has an email set, issue them a password (8+ characters) in the field below it — the password isn't shown again after saving, so tell them what you set through whatever channel you like. They then sign in with that email and password directly on the home page.

This is a genuinely weaker credential than Google's — it lives entirely in this app rather than being backed by Google's account security — which is why it comes with real (if proportionate for three friends) protections in `src/lib/password.ts`:

- **scrypt**, not a fast general-purpose hash — makes each guess deliberately expensive.
- **Identical error for a wrong password and an unregistered email** ("Incorrect email or password"), including running a real scrypt hash on the unknown-email path too, so the response doesn't time differently and reveal which case it was. An attacker probing the form learns nothing about who's actually registered.
- **Lockout after 5 consecutive failures**, 15 minutes, checked before the password comparison ever runs — so once triggered, even the correct password is refused until it clears.

A player can hold both credentials at once — Google and a password both prove the same `email`-identified account — or just one. Setting a password does not require Google to be configured, and vice versa.

### Password reset

There's no email to send a reset link through, so "reset" is self-service rather than link-based: any logged-in player can change their own password from the **Account** page (click your name, top right) — `src/app/account`. Changing an existing password requires typing the current one first, so a stolen session can't silently lock the real player out; setting one for the first time (a Google-only player) skips that, since being logged in via Google already proved who they are.

That covers "I want to change my password" and, for anyone with Google linked, "I forgot my password" too — sign in with Google, then set a new one. The one case it doesn't cover is a player with **only** a password, who's forgotten it: there's nothing to recover with, so the admin resets it for them from Admin → Registration, same as always.

## Importing the spreadsheet

The importer reads a JSON dump rather than the `.xlsx` directly:

```bash
npm run dump -- "/path/to/TWG Comp.xlsx" > scripts/workbook.json
npm run import:workbook
```

This loads the honour board (2012/13 onward) and every past season's predictions. Historical seasons are flagged `isImported` and keep the winner the honour board records, even where re-scoring disagrees — revising past results is the group's call, not the importer's.

Tournament sheets (`WC 2026`, `Euro 2024`, `WC 2022`, `Euro 2020`) are **not** imported. Their format — group-stage positions plus per-match scorelines through every knockout round — is a different prediction system. The schema has room for it; the code does not yet.

## How scoring works

Nothing about a specific competition is hard-coded. A season is a bag of `SeasonCompetition`s, each owning the `Slot`s to be predicted. Adding a league next year is data entry, not a migration — which is why the importer handles 2018/19 (15 competitions, including Portugal, Australia and Scotland) and 2025/26 (10) with the same code.

| Rule | Scoring |
|---|---|
| `EXACT_POSITION` | 3 exact · 1 inside the band · 0 outside |
| `SET_MEMBERSHIP` | 3 in the set · optional 1 in a wider near-miss band |
| `KNOCKOUT_STAGE` | 3/1/1 domestic · 5/3/1 European (W/RU/SF) |
| `TOP_SCORER_PLAYER` | 3 exact · 1 inside the top 3 |
| `TOP_SCORER_COUNT` | 3 exact · 1 within ±3 goals |

Scoring is **exclusive, not additive**: calling Arsenal as champions scores 3, never 3 + 1.

Bands and point values live in the `Ruleset` row, with per-competition overrides on `SeasonCompetition.ruleOverrides`. That is how the Premier League uses a top-4 band while the Championship uses top-6, and the UCL pays 5/3/1 while the FA Cup pays 3/1/1, with no special cases in code.

**Changing scoring in a future year means creating a new `Ruleset` row, never editing an existing one.** Past seasons resolve against the ruleset they were scored under.

### Knockout competitions

Each European competition asks for a winner plus four semi-finalists. **The five slots are independent, and the same club may hold more than one of them.** Naming your winner among your own semi-finalists is a strategic choice, not a mistake: it doubles up if that club gets there, at the cost of one of your four coverage spots. Spreading across four different clubs covers more of the draw but gives up the double.

The engine scores every slot on its own, so both routes pay exactly what they should:

| Your pick | Winner slot | Semi-final slot | Total |
|---|---|---|---|
| Club wins the competition | 5 | 1 | **6** |
| Club loses the final | 3 | 1 | **4** |
| Club loses the semi-final | 1 | 1 | **2** |
| Club goes out earlier | 0 | 0 | **0** |

The winner slot paying **1 for reaching the semi-finals** is easy to miss and is load-bearing for reading the old sheets. A winner pick has scored exactly 1 on eight occasions — Barcelona 2018/19, Man Utd 2019/20, Man City 2021/22, Real Madrid 2022/23, Roma and Aston Villa 2023/24, Athletic Club and Fiorentina 2024/25 — every one a genuine semi-finalist who fell short of the final.

A semi-finalist slot asks only "did this club reach the last four?", so a club that went on to win still scores there.

The Championship works the same way: the champion is also promoted, so a club may hold both the winner slot and a promotion slot.

### Rejected picks

The app blocks only duplicates that **cannot both come true** — the same club in two league positions, or named both as a top-four finisher and as relegated. A club has one finishing position, so those picks silently waste themselves.

Everything else is allowed, including the cup strategies above. Matching is alias-aware, so "Man City" and "Manchester City FC" collide. The groups are one short list, `EXCLUSIVE_GROUPS` in `src/lib/predictions.ts`. Imported history is never validated.

### Championship promotion

3 points per correctly predicted promoted club — both automatic spots and the play-off winner — and 1 for a club that finishes in the top 6 without going up. The play-off winner is not in any API table, so it is entered under **Admin → Results**; until it is, promotion picks read as undecided rather than wrong.

## Results

`FOOTBALL_DATA_API_KEY` from [football-data.org](https://www.football-data.org/client/register) (free tier). The worker syncs every six hours; `npm run sync` runs it now.

**Covered automatically:** Premier League, Championship, La Liga, Serie A, Bundesliga, Ligue 1, Eredivisie, Primeira Liga, Champions League — tables and top scorers.

**Entered by hand** under Admin → Results, because the free tier has no domestic cups and no secondary European competitions: FA Cup, Copa del Rey, Coppa Italia, DFB-Pokal, Europa League, Conference League.

Enter semi-finalists as soon as they're known — they score on their own, and the leaderboard updates without waiting for the final.

### API-Football

Evaluated as a replacement for football-data.org, because it covers 1,200+ leagues **and cups** and would remove manual entry entirely.

**The free plan cannot run the live season.** It serves seasons 2022–2024 only; anything newer returns HTTP 200 with `{"errors":{"plan":"Free plans do not have access to this season, try from 2022 to 2024."}}`. Confirmed directly against the 2026 Premier League standings and top-scorer endpoints. The free plan also caps requests per *minute* as well as the advertised 100/day — exceeding it returns a bare 429, which reads like a data problem rather than a pacing one.

Making it the live provider means the Pro plan, $19/mo (~$228/yr). Whether that is worth it comes down to the manual entry it replaces: five cups, each needing a winner, a runner-up and four semi-finalists, entered once or twice a season. Perhaps fifteen minutes a year. The recommendation is to stay on football-data.org.

What the free plan **is** good for is history. Seasons 2022, 2023 and 2024 map onto the imported 2022/23, 2023/24 and 2024/25 seasons, so real results can be backfilled and those years re-scored against reality rather than against the spreadsheet's own arithmetic:

```bash
npx tsx scripts/backfill-historical.ts   # fetch and store real results
npx tsx scripts/compare-history.ts       # re-score, diff against the sheet
```

Switching providers later is contained: `apiFootballId` already sits alongside `providerCode` in `src/lib/competitions.ts`, and `src/lib/results/apiFootball.ts` implements the same three fetches as the football-data client.

#### One trap worth knowing

API-Football duplicates a player's top-scorer row against their **current** club, so a single spell appears twice with identical totals. Sørloth's 2022/23 La Liga season comes back as `Real Sociedad 12` *and* `Atletico Madrid 12`; summing them crowns him Pichichi on 24, ahead of Lewandowski's actual 23. The same quirk inflated Matheus Cunha to 30 in 2024/25, displacing Salah's real 29.

Identical totals mean duplication; differing totals mean a genuine mid-season transfer that does need adding. `leagueGoals()` in `src/lib/results/apiFootball.ts` handles both, and `tests/apiFootball.test.ts` pins the cases down.

## Signal bot

**Deferred past v1.** Everything below works, but the group decided the CAPTCHA/spare-number setup wasn't worth doing before the season starts — this section is a working recipe for whenever it's picked back up.

Signal has no official bot API, and **registering an account still requires a phone number** — usernames (2024) are only a discovery handle. So: register the bot on a spare number, then set a username and hide the number, and the group only ever sees the handle.

```bash
docker compose --profile signal up -d signal-api
# Register the bot's number, then link it:
open http://localhost:8080/v1/qrcodelink?device_name=twg-bot
```

Then set `SIGNAL_BOT_NUMBER` and `SIGNAL_GROUP_ID` in `.env`. List group ids with `curl localhost:8080/v1/groups/<number>`.

Match each player to their Signal number so `/me` and `/picks` work — the bot records the uuid on first contact:

```sql
UPDATE Player SET signalNumber = '+61400000000' WHERE handle = 'KV';
```

Commands: `/leaderboard`, `/me`, `/card <player>`, `/picks <player>`, `/changes`, `/honours`, `/help`. Test them without Signal:

```bash
npm run bot KV
```

Anything that could expose one player's picks (`/me`, `/picks`, `/changes`) is answered by direct message even when asked in the group. Predictions are never enterable over Signal — the group chat is shared, which is the whole problem.

## Deployment

```bash
docker compose run --rm app npx prisma db push
docker compose run --rm app npm run seed
docker compose up -d
```

Three containers — web app, worker, signal-cli — sharing one SQLite file in `./data`. Back up by copying `data/twg.db`. Signal is deferred, so `signal-api` starts but sits idle with nothing configured — drop it from `docker-compose.yml` if you'd rather not run it at all.

**The machine must not sleep.** A sleeping host stops the scheduled results syncs (and, later, takes the Signal bot off the group).

### Self-hosting on a home server, reached over Tailscale

A good fit for this app: private by construction (only devices on your tailnet can reach it), no port-forwarding, no public exposure. Any small always-on machine works — a mini PC is more than enough for three lightweight containers and SQLite.

1. Install Docker and [Tailscale](https://tailscale.com/download) on the machine, and sign Tailscale into the same tailnet as KV/MC/Tok's devices.
2. Copy the repo over, set up `.env` as above, and set **`APP_ORIGIN` to the Tailscale HTTPS address you'll use** — `https://<device-name>.<your-tailnet>.ts.net` (device name and tailnet are whatever your `tailscale status` shows). This has to be right before anything else works — see the two reasons below.
3. `docker compose up -d`
4. Expose it over the tailnet with real HTTPS, persistently:
   ```bash
   tailscale serve --bg --https=443 localhost:3000
   ```
5. Anyone on the tailnet reaches it at that same `https://<device-name>.<your-tailnet>.ts.net` — no VPN client config beyond having Tailscale installed and signed into the tailnet.

**Two things `APP_ORIGIN` being wrong will break, differently:**
- **Google sign-in** needs the OAuth redirect URI registered in Google Cloud Console to match `{APP_ORIGIN}/api/auth/google/callback` *exactly*. Point Google at the Tailscale address, not `localhost` — nobody but the Nucbox itself can reach `localhost`.
- **The session cookie is marked `secure` in production**, meaning the browser refuses to send it over plain HTTP. `tailscale serve` gives you real HTTPS termination, which is why step 4 isn't optional — serving the app over bare HTTP on the tailnet (skipping `tailscale serve`) would have sign-in silently fail: the cookie gets set, the browser just won't send it back.

Password sign-in doesn't care about exact origin matching the way Google does, so if you'd rather skip the Google Cloud Console setup for now, email + password alone works fine over this same Tailscale setup.

## Tests

```bash
npm test
```

Alongside unit tests for every rule boundary, `tests/replay-202526.test.ts` replays the real 2025/26 predictions through the engine and compares all 108 cells against the spreadsheet — the only season where the sheet's own point values are internally consistent enough to reverse-engineer results from (see below). `tests/apiFootball.test.ts` locks down the API-Football response quirks described here.

For 2022/23, 2023/24 and 2024/25, real results are available directly — see [Verifying against real results](#verifying-against-real-results) — and the comparison is run against fact rather than inference.

### Known spreadsheet errors

**2025/26**, checked by inverting the sheet's own point values (`tests/replay-202526.test.ts`, asserts exactly these three and fails if the count changes):

| Player | Slot | Pick | Sheet | Correct | Why |
|---|---|---|---|---|---|
| Tok | Spain – 2nd | Barcelona | 3 | 1 | Barcelona finished 1st — it scored 3 as KV's and MC's *winner* pick. Calling it 2nd is a top-4 near miss. |
| Tok | UCL Semi Finalist | Real Madrid | 0 | 1 | The same pick scored 1 for both KV and MC. |
| MC | UCL Semi Finalist | Barcelona | 1 | 0 | KV picked Barcelona to win the UCL and scored 0. Since a winner pick scores 1 for reaching the semi-finals, Barcelona cannot have been a semi-finalist. |

**This changes who won 2025/26.** Corrected, KV and MC finish level on 44 (the sheet has MC 45, KV 44), so the season is a tie rather than an MC win. The honour board still records MC — the app does not rewrite history on its own.

**2022/23 – 2024/25**, checked against real results from API-Football (`npx tsx scripts/compare-history.ts`) — roughly 25 more cells, all independently corroborated (Kane's 36-goal Bundesliga scoring record, Luton's 2023/24 relegation, Leicester's 2023/24 promotion as champions, Burnley's 2024/25 promotion, the Barcelona/Real Madrid 2024/25 La Liga race, Bayern edging Dortmund in 2022/23). Two shapes stand out:

- **Whole rows forgotten.** Every player who picked the actual Golden Boot winner in a given league/season scored 0 across the board — not one player missed, all of them, in the same slot. Consistent with the row being skipped when the sheet was filled in, not three independent mistakes.
- **The win-slot semi-final consolation, missed repeatedly.** The rule — a cup winner pick scores 1 if that club merely reached the semis — is well evidenced (8 clean historical hits, see [Knockout competitions](#knockout-competitions)) but was missed on further occasions across these three seasons alone.

If the engine ever reproduces the sheet exactly on a season with independently checkable results, it has inherited the errors, and the comparison should be treated as broken, not clean.

### Bugs this uncovered (now fixed)

Two real engine bugs surfaced while checking 2022–2024 against results the sheet never had:

- **Extra-time and penalty finals lost their winner.** `fetchCupStage()` only recognised `status: "FT"`. API-Football marks a final decided after 90 minutes differently from one decided after extra time (`AET`) or penalties (`PEN`) — Barcelona's 2024/25 Copa del Rey win over Real Madrid went to extra time and was silently dropped, along with Sevilla's 2022/23 Europa League and Athletic Club's 2023/24 Copa del Rey, both won on penalties. football-data.org does not have this problem — it reports a single `FINISHED` status regardless of how the match ended, confirmed against its docs.
- **Golden Boot ties scored by array position, not by goals.** Kane and Mbappé jointly led the 2023/24 Champions League on 8 goals each; the naive implementation read Mbappé's array slot as "3rd" and gave him 1 point instead of the 3 a joint Golden Boot winner is due. Fixed to rank by distinct goal tallies (dense ranking) — confirmed against match reports and against the sheet's own credited outcomes, which only make sense under that convention.

Also fixed, unrelated to results-fetching: `samePerson()` didn't recognise API-Football's initial-form names ("E. Haaland") against a full-name prediction ("Erling Haaland"), silently zeroing correct picks, and didn't handle Dutch/Belgian surname prefixes ("L. de Jong" is one surname, not "de" as a first initial plus "Jong"). And `CHAMPIONSHIP_OVERRIDES` originally widened the **winner** slot's near-miss band to top-6 on an unconfirmed guess; checked against history (West Brom 2nd in 2019/20, Brentford 3rd in 2020/21 — the only two times that slot has ever paid a near-miss, both inside the ordinary top-4 band), that override has been removed. The top-6 consolation is real, but it belongs only to the promotion picks, which is what was actually confirmed.

### Verifying against real results

football-data.org's free tier has no history — everything above required a second source. [API-Football](https://www.api-football.com/pricing)'s free tier serves exactly seasons 2022–2024, which happens to cover three imported seasons:

```bash
npx tsx scripts/backfill-historical.ts     # fetch and store real results for 2022/23, 2023/24, 2024/25
npx tsx scripts/check-team-resolution.ts   # confirm every stored prediction resolves to a known club
npx tsx scripts/compare-history.ts "2022/23" "2023/24" "2024/25"
```

`check-team-resolution.ts` is worth running after any alias change — it checks every TEAM-valued prediction in the backfilled seasons against the clubs actually present in that competition's stored results, which catches a silent 0-score from a missing alias that a disagreement-only diff can hide (a wrong pick and an unresolved name both score 0, so only one of them is a bug).

## Not built yet

- **Signal bot.** Deferred, not cancelled — see [Signal bot](#signal-bot).
- **Tournament mode** (World Cup / Euros). Next one is Euro 2028.
- **Team-name autocomplete.** Picks are free text, resolved through a `TeamAlias` table populated from the API. Unrecognised spellings score 0 rather than erroring.
