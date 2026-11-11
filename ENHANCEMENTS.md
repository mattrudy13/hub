# Enhancements

1. **Secret Arcade unlock.** Hide the Arcade mode button and make the mode an easter egg instead (the Konami
   code, or tapping HUB 5 times). Rudy wants this as an option, not in v0.1.
2. **Shareable Arcade link.** `?arcade=1` opens in Arcade mode, for sending to friends. Skipped in v0.1.
3. **Sound.** A short coin or blip when entering Arcade mode, off by default.
4. **More UVA.** Rotate the featured sport by what's playing today instead of by month. Worth doing before
   2026-11-28 (audit, 2026-11-11): football is featured through December by month, and at 4–5 with no bowl
   likely the tile would show a finished season for five weeks while basketball is on.
5. **King of the Court live night.** During a promo night, show the live PRA leader from `leaders-<season>.json`.
6. **Upset watch (Daily).** Flag live games where a 7+ point underdog is leading, using the pre-game lines
   already saved in `data/upsets.json`. Could also show finished upsets before the hourly run.
7. **Mark videos watched (Daily).** Let a NEW badge be dismissed per video instead of clearing on the next visit.
8. **More leagues (Daily).** NFL/NBA scores and upsets if wanted later (Rudy picked college only for v0.2).
9. **Weather or local news (Home Base).** Offered 2026-10-24 and not picked. Weather: NWS `api.weather.gov`
   (CORS allowed) for the forecast and alerts (coastal flooding on Shore Drive, tropical storms). News: WAVY,
   13NewsNow, WTKR or the Virginian-Pilot RSS through the hourly job, like `news.mjs`.
10. **Traffic (Home Base).** HRBT and bridge-tunnel delays need a free VDOT SmarterRoads data account and key;
    skipped for v0.3.
11. **Beach conditions (Home Base).** Dropped because Rudy doesn't do beach activities. If wanted later: NOAA tide
    predictions for Lynnhaven Inlet (station 8638888), wind at CBBT Chesapeake Channel (8638901), ocean wave height
    and water temperature from NDBC buoy 44099 (Cape Henry), EPA UV by ZIP 23451. All free, checked 2026-10-24.
12. **Event prices (Home Base).** Ticketmaster rarely sends prices for local venues; SeatGeek's API (free
    client id) has "lowest price" and could fill the gap.
13. **Paycheck share: better estimates (Home Base).** Three pieces are national or whole-state stand-ins
    (v0.4, 2026-11-07): car insurance is NAIC's U.S. average because its Virginia table couldn't be downloaded
    (403) — swap in the VA figure if it can be found; renters insurance is left out; electricity is the average
    Virginia home's bill, which likely runs high for an apartment (EIA's RECS has usage by housing type).
14. **Paycheck share: take-home view.** Rudy picked pay before taxes. A take-home line would need a yearly
    federal + VA + FICA estimate for a single filer.

Items 15–19 came out of the 2026-11-11 audit.

15. **Cron Worker: start NBA First Minute.** On 2026-11-11 at 10:55 AM ET its tile read "No estimate saved for
    today" with 10 NBA games on: GitHub hadn't started the 08:15 or 14:15 UTC runs yet. It has never saved after
    tip-off (0 of 19 days), so this is a blank tile for part of the day, not lost data. Add `update-data.yml` to
    `JOBS` in `worker/src/index.js` (say 9:20 AM, 12:20 PM and 4:20 PM ET, Oct–Apr), set `worker: true` on its
    row in `jobs.mjs`, and add `nba-first-minute` to the Worker's fine-grained GitHub token (Rudy has to do that
    part; it could ride along with the 2027-01-21 token renewal).
16. **Cron Worker: bowl and CFP snapshot times.** cfb-picks' `snapshot-odds.yml` is only started Sun 9 PM,
    Tue/Fri 10 AM and Sat 9 AM ET, and the Worker's comment says bowls and the CFP still need their own times.
    Needed before bowl season (mid-December 2026); conference title games on Fri Dec 4 / Sat Dec 5 fit the
    current times.
17. **January counts as off season for college football.** The cfb and Beat the Model tiles (`inMonths(9–12)`
    in `tiles.js`) and both cfb-picks rows in `jobs.mjs` (`months` 8–12) stop in December, so a stale CFP week
    in January wouldn't show "Running late" or raise a data-job alert. Add January where the apps cover it.
18. **Data Jobs: add Out & About.** Its `update.yml` is the one scheduled data job not in `jobs.mjs`, so a
    failure gets no push alert; only the Board tile's 48-hour "Running late" covers it. Needs its cron read to
    set `lateHours`. (Apartments' weekly scrape isn't there either; its tile flags a pull older than 9 days.)
19. **Push Worker: limit passphrase guesses.** `/subscribe` accepts unlimited tries. The comparison is
    timing-safe, so this only matters if `PUSH_KEY` is short. A KV counter per IP (say 5 an hour) would do.

Items 20–28 are ideas suggested 2026-11-11, after the audit; Rudy asked for all nine to be listed. The first
three were the recommended ones.

20. **Data contract check.** A Node script in the hourly job that fetches each app's JSON and asserts the
    fields the tiles read (`picks`, `result`, `monthly`...). Today a format change only shows as a tile falling
    back to a link, with the reason in the console, which can't be seen on a phone. A failed check would fail
    the run, so it emails and raises a data-job push alert.
21. **Out & About events in Things to do (Home Base).** That tile is Ticketmaster only, so it's all ticketed
    shows. Out & About's `events.json` (VB + Norfolk, markets and free events included) is already read by the
    Board's tile. Needs a kind for them and a rule for duplicates.
22. **Apps' deadlines in Coming Up (Daily).** Next Beat the Model lock (`nextLock` in `/api/summary`) and the
    next KOTC promo night (`predictions-<season>.json`), beside UVA's games and the hand-typed reminders. Daily
    is where the home-screen app opens. `COUNTDOWNS_SHOWN` is 3, so it may need a fourth row or a priority rule.
23. **Name the apps in the Board's subline.** "4 with games today" → "Beat the Model, Hoops, CFB and UVA today".
    Not the tile reshuffle Rudy turned down: the order stays fixed.
24. **Keep the Hoops tile live.** It says "Live" but only updates on a reload. Re-run its `load()` every minute
    while a game is on and the tab is visible, like the Daily page's scores.
25. **TE tile: retired categories.** Once First TD and Long shots are shadow-only (te-tracker's rule tuning,
    2026-11), the tile keeps showing their records (0–27 and 1–23 on 2026-11-11) all season. Keep, hide, or
    fold into one "retired" line: Rudy's call, and it should match what te-tracker's own page does.
26. **Markets fallback (Daily).** CNBC's quote endpoint is undocumented and blocks some clients. The hourly job
    could save the last close to `data/markets.json`, so the tile shows "as of 4 PM" instead of "Couldn't load
    market quotes". Note CNBC's CDN wants a browser User-Agent.
27. **Apartment price-drop alert (push).** After the Monday scrape, alert when the lowest `monthly` in
    `viable.json` is under last week's (kept in KV). $1,506 on 2026-11-11.
28. **Token-expiry alert (push).** The push Worker sends a reminder a week before each GitHub token expires
    (dates in its config), instead of relying on the Coming Up countdown being seen.
