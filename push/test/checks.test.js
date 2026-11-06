import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { btmAlerts, kotcAlerts, uvaAlerts, jobProblems, planJobs, fmtTime, et, isQuiet } from "../src/checks.js";

// Real data saved 2026-11-05 (see test/fixtures).
const load = (f) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url)));
const btm = load("btm-state.json");
const kotc = load("kotc-predictions.json");
const mbb = load("espn-uva-mbb.json"), cfb = load("espn-uva-cfb.json");
// An ET wall-clock time in November 2026 (EST, UTC−5).
const at = (date, hhmm) => Date.parse(`${date}T${hhmm}:00-05:00`);

test("time helpers are Eastern", () => {
  assert.equal(fmtTime(Date.parse("2026-11-06T22:00Z")), "5 PM");
  assert.equal(fmtTime(Date.parse("2026-11-08T03:30Z")), "10:30 PM");
  assert.equal(et(Date.parse("2026-11-07T03:00Z")).date, "2026-11-06");
  assert.ok(isQuiet(at("2026-11-06", "23:15")) && isQuiet(at("2026-11-06", "06:45")) && !isQuiet(at("2026-11-06", "07:00")));
});

// ---- Beat the Model ----

const saturday = "2026-11-07";
const firstSat = Math.min(...btm.games.filter((g) => g.line != null && et(Date.parse(g.start)).date === saturday).map((g) => Date.parse(g.start)));

test("BtM reminds 2 h before the day's first kickoff, once a day, not earlier", () => {
  assert.deepEqual(btmAlerts(btm, firstSat - 2 * 3600e3 - 60e3), []);
  const [a] = btmAlerts(btm, firstSat - 2 * 3600e3 + 60e3);
  assert.equal(a.key, `btm:${saturday}`);
  assert.match(a.body, /games lock today, the first at \d/);
  assert.equal(btmAlerts(btm, firstSat - 30 * 60e3)[0].key, a.key); // same key: index.js sends it once
});

test("BtM skips a day that already has a pick", () => {
  const g = btm.games.find((x) => Date.parse(x.start) === firstSat);
  const picked = { ...btm, picks: { ...btm.picks, [g.id]: { side: "home", at: "2026-11-06T12:00:00Z" } } };
  assert.deepEqual(btmAlerts(picked, firstSat - 3600e3), []);
});

test("BtM says nothing on a day with no open games", () => {
  assert.deepEqual(btmAlerts(btm, at("2026-11-10", "12:00")), []);
});

// ---- King of the Court ----

test("KOTC lock alert on a promo night after the first tip, with the picks", () => {
  const tip = Date.parse(kotc.days["2026-11-04"].firstTip); // 7 PM ET
  assert.deepEqual(kotcAlerts(kotc, tip - 60e3).filter((a) => a.key.startsWith("kotc-lock")), []);
  const lock = kotcAlerts(kotc, tip + 5 * 60e3).find((a) => a.key === "kotc-lock:2026-11-04");
  assert.ok(lock);
  assert.match(lock.body, /^\$2M pool · 14 games\. Picks: .+ \d+%, .+ \d+%, .+ \d+%\.$/);
  assert.equal(kotcAlerts(kotc, tip + 4 * 3600e3).filter((a) => a.key.startsWith("kotc-lock")).length, 0); // too late
});

test("KOTC never alerts on a non-promo night", () => {
  const tip = Date.parse(kotc.days["2026-11-02"].firstTip);
  assert.deepEqual(kotcAlerts(kotc, tip + 10 * 60e3).filter((a) => a.key.startsWith("kotc-lock")), []);
});

test("KOTC result the next morning, not during quiet hours, not for old nights", () => {
  assert.deepEqual(kotcAlerts(kotc, at("2026-11-05", "06:45")), []);
  const [r] = kotcAlerts(kotc, at("2026-11-05", "07:00"));
  assert.equal(r.key, "kotc-result:2026-11-04");
  assert.match(r.title, /^King of the Court · \S+ won$/);
  assert.match(r.body, /\d+ PRA\. (None of our 3 picks won\.|.+ one of our 3 picks\.)$/);
  assert.deepEqual(kotcAlerts(kotc, at("2026-11-08", "09:00")), []); // 4 days later
});

// ---- UVA ----

const teams = [{ sport: "Basketball", data: mbb }, { sport: "Football", data: cfb }];
const tipoff = Date.parse(mbb.team.nextEvent[0].date); // vs Northeastern, 2026-11-06 5 PM ET

test("UVA alert lands in exactly one 15-minute cron run before the game", () => {
  const hits = [];
  for (let t = tipoff - 3 * 3600e3; t < tipoff; t += 15 * 60e3) hits.push(...uvaAlerts(teams, t));
  assert.equal(hits.length, 1);
  assert.deepEqual(hits[0], {
    key: `uva:${mbb.team.nextEvent[0].id}`,
    title: "UVA vs Northeastern",
    body: "Tips at 5 PM on ACC Network.",
    url: "https://mattrudy13.github.io/hub/daily.html",
  });
});

test("UVA skips games without a set time", () => {
  const tba = structuredClone(mbb);
  tba.team.nextEvent[0].competitions[0].timeValid = false;
  assert.deepEqual(uvaAlerts([{ sport: "Basketball", data: tba }], tipoff - 50 * 60e3), []);
});

test("UVA football says kicks off and away games say at", () => {
  const away = structuredClone(cfb);
  for (const c of away.team.nextEvent[0].competitions[0].competitors) c.homeAway = c.id === "258" ? "away" : "home";
  const kick = Date.parse(away.team.nextEvent[0].date);
  const [a] = uvaAlerts([{ sport: "Football", data: away }], kick - 50 * 60e3);
  assert.match(a.title, /^UVA at /);
  assert.match(a.body, /^Kicks off at /);
});

// ---- Data jobs ----

const ok = (iso) => ({ status: "completed", conclusion: "success", created_at: iso, html_url: "https://github.com/x/runs/1" });
const failed = (iso) => ({ ...ok(iso), conclusion: "failure", html_url: "https://github.com/x/runs/2" });

test("jobProblems flags failed and late jobs, keyed by the run", () => {
  const now = at("2026-11-06", "14:00");
  const runs = {
    "hub/update-daily.yml": [failed("2026-11-06T18:20:00Z"), ok("2026-11-06T17:20:00Z")],
    "kotc-tracker/update-data.yml": [ok("2026-11-05T15:20:00Z")], // 23.7 h ago, lateHours 10
    "uva-records/refresh.yml": [ok("2026-11-06T14:00:00Z")],
  };
  const p = jobProblems(runs, now);
  assert.deepEqual(p.map((x) => [x.id, x.status]), [["kotc-tracker/update-data.yml", "late"], ["hub/update-daily.yml", "failed"]]);
  assert.equal(p[1].key, "job:hub/update-daily.yml:failed:2026-11-06T18:20:00Z");
  assert.equal(p[1].url, "https://github.com/x/runs/2");
});

test("a job problem in quiet hours is held, then sent at 7 AM only if still broken", () => {
  const prob = { id: "a/x.yml", status: "late", label: "App · Job", lastRun: "2026-11-06T01:00:00Z", url: "u" };
  const night = planJobs({ fresh: [prob], held: [], stillBad: new Set(["a/x.yml"]), now: at("2026-11-06", "02:00") });
  assert.deepEqual(night, { alerts: [], held: [prob] });

  const morning = planJobs({ fresh: [], held: night.held, stillBad: new Set(["a/x.yml"]), now: at("2026-11-06", "07:00") });
  assert.equal(morning.alerts.length, 1);
  assert.equal(morning.alerts[0].title, "Data job late");
  assert.deepEqual(morning.held, []);

  const fixed = planJobs({ fresh: [], held: night.held, stillBad: new Set(), now: at("2026-11-06", "07:00") });
  assert.deepEqual(fixed, { alerts: [], held: [] });
});

test("several job problems become one summary", () => {
  const a = { id: "a", status: "late", label: "A · Update", lastRun: null, url: "u" };
  const b = { id: "b", status: "failed", label: "B · Snapshot", lastRun: null, url: "u" };
  const { alerts } = planJobs({ fresh: [b], held: [a], stillBad: new Set(["a", "b"]), now: at("2026-11-06", "07:00") });
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].title, "2 data jobs need a look");
  assert.equal(alerts[0].body, "A · Update (late); B · Snapshot (failed).");
});
