# Enhancements

1. **Secret Arcade unlock.** Hide the Arcade mode button and make the mode an easter egg instead (the Konami
   code, or tapping HUB 5 times). Rudy wants this as an option, not in v0.1.
2. **Shareable Arcade link.** `?arcade=1` opens in Arcade mode, for sending to friends. Skipped in v0.1.
3. **Sound.** A short coin or blip when entering Arcade mode, off by default.
4. **More UVA.** Rotate the featured sport by what's playing today instead of by month.
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
