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
- `style.css`: tokens for 2 skins × 2 themes, plus the Arcade overrides.

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

## Dev notes

- Preview: `python3 -m http.server 8765` in this folder. Phone check: Chrome's window wouldn't shrink to
  390 px, so load the page in a 390 px iframe and check `scrollWidth`.
- No tooltips (Rudy's rule); definitions go in visible sub-lines.
- Commits: Conventional Commits. No commits or pushes 8am–5pm ET on weekdays unless asked.
