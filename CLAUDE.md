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
- `style.css`: tokens for 2 skins × 2 themes, plus the Arcade overrides and the Daily page's styles.
- `daily.html` + `daily.js`: the Daily page (see below).
- `scripts/news.mjs`, `scripts/upsets.mjs`, `scripts/youtube.mjs`: write `data/*.json` for the Daily page, run
  hourly by `.github/workflows/update-daily.yml`.
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

Rudy's "what happened today" page: markets, headlines, college scores, upsets and new YouTube videos. Theme toggle
only, no Arcade mode (Rudy's choice: double wording isn't worth it for headlines). Linked from the hub
masthead ("Daily →") and back ("← Hub").

| Tile | Source | Rules |
|---|---|---|
| Markets | CNBC quote service, live in the browser | S&P 500 (`.SPX`) and Nasdaq Composite (`.IXIC`): % change big, points and level small (2 decimals). Top of the page on every width: a normal tile on a phone, a one-row strip from 700 px (about 85 px tall) so the scores start on the first screen. Live = weekdays 9:30 AM–4 PM ET and the newest quote is from today, polled every 60 s; otherwise Closed, showing the last session's change ("Thursday's close"), rechecked every 10 min. CNBC's `curmktstatus` is useless for this (still `REG_MKT` at 7:30 PM). No holiday list: a holiday's newest quote is from an earlier day, so it reads Closed. CNBC's CDN returns Access Denied without a browser User-Agent, so test with `curl -A "Mozilla/5.0 …"`. |
| Headlines | `data/news.json` (`news.mjs`) | US & World (NPR, BBC World), Business (CNBC top news, MarketWatch bulletins), Tech (The Verge, Ars Technica). 3 per section (Rudy cut it from 5), newest first, max 2 per source so both feeds show. A failed feed keeps its last headlines. |
| College Football / Basketball | ESPN scoreboard, live in the browser | Yesterday + today (ET). Shown: any Top 25 team, UVA (team id 258) or ACC (conferenceId 1 in football, 2 in basketball). Basketball = default board + `groups=2` (the full D-I board is ~1.7 MB). First 10 games, then "Show N more". A tile with no games is hidden and the other tiles in the row widen (Rudy's choice; CSS `:has()` on `.scores[hidden]`). Polls every 60 s while a game is live or due, every 10 min if games are later today, never in a hidden tab. |
| Upsets | `data/upsets.json` (`upsets.mjs`) | Underdog of 7+ points (DraftKings line via ESPN) won outright, any FBS or D-I men's game, yesterday + today. |
| YouTube | `data/youtube.json` (`youtube.mjs`) | Newest full-length upload per channel (the `UULF…` playlist: no Shorts or live streams). Hidden until the file exists. From 700 px, two columns of cards with the thumbnail on the left (Rudy wanted smaller thumbnails). |

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

## Dev notes

- Preview: `python3 -m http.server 8765` in this folder. Phone check: Chrome's window wouldn't shrink to
  390 px, so load the page in a 390 px iframe and check `scrollWidth`.
- No tooltips (Rudy's rule); definitions go in visible sub-lines.
- Commits: Conventional Commits. No commits or pushes 8am–5pm ET on weekdays unless asked.
