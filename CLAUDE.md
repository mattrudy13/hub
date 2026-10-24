# Hub: project notes

A personal portal for Rudy's 7 apps at https://mattrudy13.github.io/hub/ (repo `mattrudy13/hub`, Pages from
`main` at the root). It's for Rudy's daily check and for friends, **not recruiters**: no bio, no skills, and
no link to the portfolio at the root (that site is recruiter-facing and separate). Started 2026-10-22, v0.1.

## Files

- `index.html`: the ticker, masthead (Arcade mode and theme buttons) and the tile grid. Scripts load in order:
  `common.js`, `tiles.js`, `feed.js`.
- `common.js`: `BASE` (empty on mattrudy13.github.io, otherwise the live site, so local preview reads live
  data cross-origin), `getJson`, `getSeason` (this season's file, else last season's), ET date and
  formatting helpers, and `setupToggles()`.
- `tiles.js`: `TILES`, one adapter per app. `load()` returns `{ tag, body, updated | when/arWhen, live, hot, late? }`.
  A thrown error makes the tile fall back to its name and link (the console says why): that's how a format
  change in an app shows up.
- `feed.js`: the commit ticker.
- `style.css`: tokens for 2 skins × 2 themes, plus the Arcade overrides and the Daily and Home Base pages' styles.
- `daily.html` + `daily.js`: the Daily page (see below).
- `homebase.html` + `homebase.js`: the Home Base page (see below).
- `scripts/news.mjs`, `scripts/upsets.mjs`, `scripts/youtube.mjs`: write `data/*.json` for the Daily page;
  `scripts/events.mjs`, `scripts/housing.mjs` for Home Base. All run hourly by `.github/workflows/update-daily.yml`.
- `worker/`: the Cloudflare cron Worker that starts the workflow hourly (see Daily page).
- `channels.txt`: the YouTube channels on the Daily page, one URL or @handle per line.

## Data sources per tile (paths under https://mattrudy13.github.io/)

| Tile | Files | Rule mirrored from the app |
|---|---|---|
| kotc | `kotc-tracker/data/predictions-<season>.json` | index.html: tonight's promo, else the next one; picks = locked `picks`; last = newest promo with `result` (`kings`, `kingPra`) |
| fm | `nba-first-minute/data/predictions-<season>.json` | `days[todayET]`; model.html graded days = days with `result` (`games`, `yes`) |
| cfb | `cfb-picks/data/picks-<season>.json` | current model = newest pick's `model`; record = its spreads, `recordOf` (common.js); status = newest spread's |
| te | `te-tracker/data/picks-<season>.json` | official = `!shadow`; record per category (likely, value, longshot, due, first, fade), Rudy's choice over one combined number |
| uva | `uva-records/site-data/sports.json`, `seasons.json`, `games/<slug>.json` | featured sport by month (football Jul–Dec, men's basketball Jan–Mar, baseball Apr–Jun); "teams with games left" = current season with a `next` date |
| apts | `apartments/data/viable.json`, `summary.json` | cheapest viable unit by `monthly` (same number as the site and digest); last pull = newest complex `date` |
| h2h | none | form opens `h2h/<cfb|cbb>-h2h.html?t1=&t2=` |

Season = the year the season starts (Aug–Dec: this year; Jan–Jul: last year).

## Stale thresholds ("Running late" in the footer)

Only in season. kotc and fm: 30 h after `updated` (Oct–Jun). cfb: 60 h (Sep–Dec; snapshots are Sun/Tue/Fri/Sat).
te: 100 h after the newer of `updated` and `graded` (Sep–Jan). uva: `built` older than 2.5 days.
apartments: last pull older than 9 days (weekly Monday scrape). Adjust in `TILES` if an app's schedule changes.

## Feed

`GET api.github.com/repos/mattrudy13/<repo>/commits?per_page=15` for the 7 repos. `data:` / `chore(data):`
commits collapse into "data refreshed N×"; feat/fix/refactor/perf show their subject; docs, chore and style are
hidden. The result is cached in localStorage (`hub:feed:v1`) for 10 minutes because unauthenticated calls are limited to 60/hour per IP. If any
repo fails (rate limit), the cached feed is shown; if there's nothing cached, the ticker hides. The ticker
pauses on hover/focus and has a pause button (WCAG: moving content needs a way to stop it); with reduced motion it
doesn't move and scrolls by hand instead.

## Skins

- Scoreboard is the default. Arcade mode = `data-skin="arcade"` on `<html>`. Every tile renders both wordings
  (`.sb` / `.ar`, via `dual()`), so switching is instant; CSS hides the other one. Arcade copy is "all in"
  (Rudy's choice): game-style labels and data lines, but the numbers are identical.
- Arcade fonts (Press Start 2P, VT323) load the first time Arcade mode is turned on.
- Arcade mode is **not** remembered (Rudy's choice); the theme is (`hub:theme`). Switching in plays a
  ~380 ms CRT flicker, skipped with reduced motion.
- Light/dark tokens for both skins live in `style.css`. Arcade blocks come after the Scoreboard ones so they win
  at equal specificity.
- The design came from 4 mockups (Scoreboard, Home screen, Bento, Arcade): https://claude.ai/artifact/WSNMV5PhLrt7AETzqQUThM

## Daily page (`daily.html`, added 2026-10-22, v0.2)

Rudy's "what happened today" page: markets, weather, what's coming up, headlines, college scores, upsets, the AP
Top 25, new YouTube videos and whether the apps' data jobs are running. Theme toggle only, no Arcade mode (Rudy's
choice: double wording isn't worth it for headlines). Linked from the hub masthead ("Daily →") and back ("← Hub").
Weather, Coming Up, the Top 25, the TV/spread lines, the pick badges and Data Jobs were added 2026-10-24 (8 of 10
ideas Rudy picked).

Order: Markets, then Weather + Coming Up as a short row, Headlines, then Football, Basketball, Upsets and Top 25
sharing rows, YouTube, Data Jobs. Those four `.row-tile`s can each hide (only Upsets can't), so `arrangeRow()`
counts the ones showing into `data-row` on `<main>`: 4 or 2 take halves, 3 thirds, 1 the whole row, and on
2-column screens an odd last one goes full width. (JS, not `:has()`: four hideable tiles made the selectors unreadable.)

| Tile | Source | Rules |
|---|---|---|
| Markets | CNBC quote service, live in the browser | S&P 500 (`.SPX`) and Nasdaq Composite (`.IXIC`): % change big, points and level small (2 decimals). Beside them a rates column: 2-yr and 10-yr Treasury (`US2Y`, `US10Y`) with the change in bp (`change` × 100; CNBC's `change_pct` for yields is wrong) and the VIX; plain ink, not red/green. All in one request. Top of the page on every width: a normal tile on a phone (rates as a row underneath), a one-row strip from 700 px (about 108 px tall, 129 with futures). Live = weekdays 9:30 AM–4 PM ET and the newest quote is from today, polled every 60 s; otherwise Closed, showing the last session's change ("Friday's close"), rechecked every 10 min. After the close the index's `last_time` is a bare date ("2026-10-23"), used as is (Date would read it as the evening before in ET). **Futures** (`@SP.1`, `@ND.1`, Rudy's choice: a small line under each index while closed): shown only once the evening session has opened, i.e. `previous_day_closing` equals `settlePrice` and `settleDate` ≥ the index's session. Before that CNBC's futures change is the day's move again. Futures `last_time` is useless (stamped with the next trade date). Nasdaq's future is the Nasdaq 100's; the footer says so. CNBC's `curmktstatus` is useless too (still `REG_MKT` at 7:30 PM). No holiday list: a holiday's newest quote is from an earlier day, so it reads Closed. CNBC's CDN returns Access Denied without a browser User-Agent, so test with `curl -A "Mozilla/5.0 …"`. |
| Weather | Open-Meteo, live in the browser (no key) | Virginia Beach (36.85, −75.98; Rudy lives there). Now (temp + WMO code in words), today's high/low, the peak rain chance over the rest of today ("Rain unlikely" under 20%) and sunset. Times come back as ET clock strings, formatted without Date. Every 30 min. Footer links the NWS forecast. |
| Coming Up | ESPN team schedule (`teams/258/schedule?seasontype=2` and `3`) + `data/countdowns.json` | UVA's next football and men's basketball game (opponent, vs/at, time or "time TBA" when `timeValid` is false, TV), plus Rudy's dated reminders. Soonest 3 (kept short above the scores). The default schedule (no `seasontype`) is empty in basketball's preseason. |
| Headlines | `data/news.json` (`news.mjs`) | US & World (NPR, BBC World), Business (CNBC top news, MarketWatch bulletins), Tech (The Verge, Ars Technica). 3 per section (Rudy cut it from 5), newest first, max 2 per source so both feeds show. A failed feed keeps its last headlines. Below 900 px the sections are tabs, one at a time (Rudy's choice; the last tab is remembered in `hub:daily:newsTab`). |
| College Football / Basketball | ESPN scoreboard, live in the browser | Yesterday + today (ET). Shown: any Top 25 team, UVA (team id 258) or ACC (conferenceId 1 in football, 2 in basketball), plus any football game cfb-picks has a pick on. Boards keep every game and `visible()` filters at render time, because the picks can load after the scores. Each row: TV network + DraftKings line before kickoff ("ESPN · MIA −20.5"), the network while live. **Pick badge:** the current model's official spreads (`!shadow`, `cat: "spread"`, same model rule as the hub's cfb tile), matched on `gameId` = ESPN event id: "Model: Oregon −7.5", then covering / not covering live (picked score + line − other score) and won/lost at the final (the graded `result` if there is one). Basketball = default board + `groups=2` (the full D-I board is ~1.7 MB). First 10 games, then "Show N more". A tile with no games is hidden (Rudy's choice). Polls every 60 s while a game is live or due, every 10 min if games are later today, never in a hidden tab. |
| Upsets | `data/upsets.json` (`upsets.mjs`) | Underdog of 7+ points (DraftKings line via ESPN) won outright, any FBS or D-I men's game, yesterday + today. |
| AP Top 25 | ESPN `rankings` (football and men's basketball), live | Ranks 1–10 with the move since last week (▲/▼/–/New; nothing in a preseason poll, where `previous` is 0 for everyone), 11–25 folded (Rudy's choice). Records hidden when 0-0. Football Aug 15–Jan 20, basketball Oct 1–Apr 15; tabs when both, the last pick remembered in `hub:daily:top25Tab`. Tag = UVA's rank when ranked. Hidden when neither poll is in season. |
| YouTube | `data/youtube.json` (`youtube.mjs`) | Newest full-length upload per channel (the `UULF…` playlist: no Shorts or live streams). Hidden until the file exists. Cards with a small thumbnail on the left: a list on a phone, two columns from 700 px (Rudy wanted smaller thumbnails). |
| Data Jobs | GitHub `actions/workflows/<file>/runs`, live in the browser | 8 jobs in `JOBS` (daily.js): each app's update job and the two odds snapshots, plus the hub's own. Per-repo run lists don't work: Pages deploy runs crowd them out. Failed = newest finished run (not cancelled/skipped) failed. Late = in its cron months and no run within `lateHours` (the longest gap in its cron schedule plus slack; each one's math is commented). "Season starting" instead of late right after its months begin. The hub row says whether the Worker or GitHub's schedule started it. Cached 20 min in `hub:daily:health:v1` (unauthenticated: 60 calls/h per network, shared with the commit ticker); on a rate limit it shows the last check and says so. All OK = one folded line at the bottom; a failed or late job moves the tile under Markets (a DOM move) with a red tag (Rudy's choice). **If a workflow's schedule changes, update its `months`/`lateHours`.** |

- **Coming Up reminders:** `data/countdowns.json`, `items: [{ date, label, note? }]`, edited by hand (dates ET).
  Past dates drop off. It's public: anyone who opens the page sees them. Dated checks from
  `~/Desktop/coding/GitHub/NEXT-STEPS.md` can be copied in.

- **Upset lines:** ESPN's scoreboard drops `odds` once a game is final, but the game's `summary`
  (`pickcenter`) keeps them. `upsets.mjs` saves each pre-game line every run (`lines` in the file, keyed
  `<league>:<event id>`, pruned to the 2-day window) and reads `summary` only for finals it never saw before
  kickoff. `node scripts/upsets.mjs --date 2026-10-18 --out /tmp/x.json` tests a past day (Oct 17 had 6).
- **NEW badge:** compares each video's `seen` (when the workflow first saw it, kept across runs) with the
  last visit, not the upload time, because a video reaches the file up to an hour after it's posted. A visit
  ends after 30 minutes away (`hub:daily:visit` in localStorage, per device); the first visit counts the last
  24 h as new.
- **YouTube API key:** repo secret `YOUTUBE_API_KEY` (YouTube Data API v3). Without it the step skips. Each
  channel costs 2 quota units per run (10,000/day free). Public channel RSS feeds were returning 404/500 in
  Oct 2026, which is why the API is used.
- **Cron Worker (`worker/`):** GitHub's schedule ran only 3 of ~10 hourly jobs on 2026-10-23, so the Cloudflare
  Worker `hub-daily-cron` (same account as h2h's proxy) starts the workflow with `workflow_dispatch` at the same
  times. It has no URL (`workers_dev = false`) and only a `scheduled` handler. Secret `GITHUB_TOKEN`: a
  fine-grained token for `mattrudy13/hub` only, Actions read/write, set 2026-10-23 and **expiring 2027-01-21** (GitHub
  only allowed 90 days). Deploy with `cd worker && npx wrangler deploy`
  (pushing doesn't deploy it). The workflow's own cron stays as a fallback; a doubled run commits nothing new.
  If runs stop: Cloudflare dashboard → Workers → hub-daily-cron → Logs (kept 3 days; `[observability]` in
  `wrangler.toml`) shows GitHub's error, e.g. 401 for an expired token.
- **Workflow:** hourly at :20 from 10:20 to 04:20 UTC (6 AM–midnight EDT). Each step runs even if another
  fails; changed files are committed as `chore(data): refresh daily data …` (ignoring `updated`), then the
  run fails if any step did, so GitHub emails. "Running late" shows when a file is over 8 h old.

## Home Base page (`homebase.html`, added 2026-10-24, v0.3)

Rudy lives in Virginia Beach (Chic's Beach / Shore Drive). He wanted an information page, not betting, built
around **things to do** and **money & housing**. Beach conditions (tides, waves, rip currents) were dropped:
he said he doesn't do those activities. Weather and local news weren't picked either. Linked from the hub
masthead ("Home Base →") and back ("← Hub"); theme toggle only.

| Tile | Source | Rules |
|---|---|---|
| Things to do | `data/events.json` (`events.mjs`, Ticketmaster Discovery API) | All of Hampton Roads (Rudy's choice): 25 miles from 36.86,−76.15, next 14 days. Parking passes, upgrades and add-ons are dropped, duplicates (one listing per ticket type) merged, cancelled shows left out; postponed/rescheduled/off sale flagged. Kinds: Music, Sports, Comedy (a genre under Arts & Theatre), Arts, Family, Other, as filter chips (remembered in `hub:home:kind`). Grouped by day, Fri–Sun marked "Weekend", first 12 then "Show N more". Until `TICKETMASTER_KEY` is set, the step skips and the tile says so. |
| Your apartments | the tracker's `apartments/data/viable.json` + `summary.json` | Big number = lowest `monthly` in viable.json (same as the hub tile, site and digest). Trend = viable units at the end of each week, each complex's latest `history` count on or before that day. |
| Mortgage rates | `data/housing.json` ← Freddie Mac `PMMS_history.csv` | 30-year (big) and 15-year, week-over-week change, a year ago. 53 weeks kept. |
| Rent / Home values | `data/housing.json` ← Zillow city CSVs (ZORI rent index; ZHVI mid-tier home value) | Virginia Beach, VA row, last 25 months, change vs the same month a year earlier. The ZHVI file is ~94 MB, so the script streams it and stops at Virginia Beach's row (sorted by size, near the top). |
| Gas | `data/housing.json` ← EIA's weekly table page (`pet_pri_gnd_dcus_r1z_w.htm`) | Regular, Lower Atlantic (PADD 1C): EIA doesn't publish Virginia alone, and its API needs a key. The newest week's cell is class `Current2`, the rest `DataB`. |

- Changes are written as words ("Up 0.05 pts from last week"), not red/green: a rise isn't good or bad for
  every number. Sparklines have no axis or tooltip (values are in the text); the end dot is a round-capped
  zero-length line so the stretched SVG doesn't turn it into an oval.
- `housing.mjs` runs inside the hourly job but skips itself unless `data/housing.json` is 20+ hours old
  (`--force` overrides). A failed source keeps its last numbers and the tile says so. "Running late" after 48 h.
- **Ticketmaster key:** repo secret `TICKETMASTER_KEY`, set 2026-10-24 (the **Consumer Key** from
  developer.ticketmaster.com → My Apps; the first value saved got HTTP 401, fixed by copying the Consumer Key
  again). Free tier 5,000 calls/day; this uses 1–3 a run. First run: 38 events through 11/7 (15 music, 13 sports,
  5 arts, 3 comedy), mostly ODU, Admirals, The NorVa, The Dome, Elevation 27, Sandler Center, Chartway Arena.
  Ticketmaster rarely includes `priceRanges` for these venues, so "From $X" is usually blank.
- This machine's network couldn't reach FRED (`fred.stlouisfed.org`, connection failed) on 2026-10-24, which
  is why mortgage rates come from Freddie Mac directly.

## Dev notes

- Preview: `python3 -m http.server 8765` in this folder. Phone check: Chrome's window wouldn't shrink to
  390 px, so load the page in a 390 px iframe and check `scrollWidth`.
- No tooltips (Rudy's rule); definitions go in visible sub-lines.
- Commits: Conventional Commits. No commits or pushes 8am–5pm ET on weekdays unless asked.
