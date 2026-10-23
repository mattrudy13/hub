# Hub

A front door to my apps, with what each one is doing today: https://mattrudy13.github.io/hub/

Each tile reads its app's own published data, so the numbers match the app and nothing here needs
updating by hand. A ticker shows recent changes across the repos. There's a light/dark switch, and an
**Arcade mode** button that turns the scoreboard into an arcade cabinet.

| Tile | App |
|---|---|
| King of the Court | [kotc-tracker](https://mattrudy13.github.io/kotc-tracker/): the next promo night's value picks and the last winner |
| NBA First Minute | [nba-first-minute](https://mattrudy13.github.io/nba-first-minute/): today's chance both teams score in the first minute |
| College Football Picks | [cfb-picks](https://mattrudy13.github.io/cfb-picks/): this week's picks and the model's spread record |
| NFL Tight End TDs | [te-tracker](https://mattrudy13.github.io/te-tracker/): this week's picks and the record by category |
| UVA Records | [uva-records](https://mattrudy13.github.io/uva-records/): the featured sport's record and last result |
| Apartments | [apartments](https://mattrudy13.github.io/apartments/): the cheapest unit that fits the budget |
| Head to Head | [h2h](https://mattrudy13.github.io/h2h/): look up any two teams' all-time series |

**Daily** (https://mattrudy13.github.io/hub/daily.html) is a second page with today's headlines, live
college football and basketball scores (Top 25, UVA and ACC), upsets by 7+ point underdogs, and the newest
videos from a few YouTube channels (`channels.txt`). A GitHub Action refreshes the headlines, upsets and
videos hourly; scores come live from ESPN.

Plain HTML, CSS and JavaScript. No build step and no server: the Action is the only backend.

## Run locally

```sh
python3 -m http.server 8765
```

Then open http://localhost:8765/. Away from mattrudy13.github.io the page reads the live data from there
(GitHub Pages allows cross-origin reads).
