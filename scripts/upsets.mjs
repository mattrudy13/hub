// Upsets for the Daily page: outright wins by underdogs of MIN_LINE+ points, yesterday and today (ET),
// across every FBS and Division I men's basketball game. Writes data/upsets.json.
//
// ESPN's scoreboard drops the spread once a game is final, so each run saves the line of every game
// that hasn't started (the last pre-game run is close to the closing line) and, for a finished game it
// never saw before kickoff, reads the line from that game's summary (`pickcenter`, which keeps it).
// Node 22, no packages. Usage: node scripts/upsets.mjs [--date YYYY-MM-DD --out file] (a past "today", for testing)

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const OUT = arg("--out") ?? "data/upsets.json";
const MIN_LINE = 7;
const ESPN = "https://site.api.espn.com/apis/site/v2/sports";
const LEAGUES = [
  { key: "cfb", path: "football/college-football", groups: "80" }, // FBS
  { key: "cbb", path: "basketball/mens-college-basketball", groups: "50" }, // Division I
];

const etDate = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);
const today = arg("--date") ?? etDate(new Date());
const yesterday = etDate(new Date(Date.parse(`${today}T12:00:00Z`) - 864e5));
const DAYS = [yesterday, today];

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

// The favorite's team id and the size of the line, or null for a pick'em or no line.
function lineOf(odds, comp) {
  if (!odds || odds.spread == null) return null;
  const line = Math.abs(Number(odds.spread));
  if (!line) return null;
  const home = comp.competitors.find((c) => c.homeAway === "home");
  const away = comp.competitors.find((c) => c.homeAway === "away");
  // `spread` is from the home team's side (MIA -19.5 at home = -19.5); the favorite flags say it directly.
  const homeFav = odds.homeTeamOdds?.favorite ?? (odds.awayTeamOdds?.favorite != null ? !odds.awayTeamOdds.favorite : Number(odds.spread) < 0);
  return { fav: (homeFav ? home : away).team.id, line, details: odds.details ?? "" };
}

const side = (c) => ({
  id: c.team.id,
  name: c.team.shortDisplayName ?? c.team.displayName,
  abbr: c.team.abbreviation,
  rank: c.curatedRank?.current <= 25 ? c.curatedRank.current : null,
  score: Number(c.score),
});

let previous = {};
try { previous = JSON.parse(readFileSync(OUT, "utf8")); } catch {}
// Keyed "<league>:<event id>". A null line means "checked, there was no line", so it isn't fetched again.
const lines = {};
for (const [k, v] of Object.entries(previous.lines ?? {})) if (DAYS.includes(v.date)) lines[k] = v;

const upsets = [];
let summaries = 0;
for (const lg of LEAGUES) {
  for (const day of DAYS) {
    const board = await getJson(`${ESPN}/${lg.path}/scoreboard?dates=${day.replaceAll("-", "")}&groups=${lg.groups}&limit=500`);
    for (const ev of board.events ?? []) {
      const comp = ev.competitions[0];
      const key = `${lg.key}:${ev.id}`;
      const state = comp.status.type.state;
      if (state === "pre") {
        const l = lineOf(comp.odds?.[0], comp);
        if (l) lines[key] = { date: day, ...l };
        continue;
      }
      if (!comp.status.type.completed) continue;
      if (!(key in lines)) {
        const summary = await getJson(`${ESPN}/${lg.path}/summary?event=${ev.id}`);
        summaries++;
        lines[key] = { date: day, ...(lineOf(summary.pickcenter?.[0], comp) ?? { fav: null, line: null }) };
      }
      const l = lines[key];
      if (!l.line || l.line < MIN_LINE) continue;
      const winner = comp.competitors.find((c) => c.winner);
      if (!winner || winner.team.id === l.fav) continue;
      const loser = comp.competitors.find((c) => c !== winner);
      upsets.push({
        league: lg.key,
        date: day,
        id: ev.id,
        line: l.line,
        details: l.details,
        link: ev.links?.find((x) => x.rel?.includes("summary"))?.href ?? ev.links?.[0]?.href ?? null,
        winner: side(winner),
        loser: side(loser),
      });
    }
  }
}

upsets.sort((a, b) => b.line - a.line || b.date.localeCompare(a.date));
console.log(`${upsets.length} upsets (${DAYS.join(", ")}); ${summaries} summaries read; ${Object.keys(lines).length} lines kept`);

mkdirSync("data", { recursive: true });
writeFileSync(OUT, JSON.stringify({ updated: new Date().toISOString(), minLine: MIN_LINE, days: DAYS, upsets, lines }, null, 2) + "\n");
