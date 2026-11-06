// What to notify about, as pure functions of each source's data and the time, so tests can replay real data
// at any moment. index.js fetches the data, skips alerts already sent (by `key`) and sends the rest.
// Each alert: { key, title, body, url }. Times are Eastern, like everything else on the Board.

import { JOBS, BAD_CONCLUSIONS, jobStatus } from "../../jobs.mjs";

const SITE = "https://mattrudy13.github.io";
const HOUR = 3600e3, MIN = 60e3;

// Quiet hours (Rudy's pick): 11 PM–7 AM ET. Only data-job alerts wait; game and pick alerts always send.
export const QUIET_FROM = 23, QUIET_TO = 7;

export function et(ms) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "numeric", minute: "numeric", weekday: "long" })
      .formatToParts(new Date(ms)).map((x) => [x.type, x.value]),
  );
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute), weekday: p.weekday };
}
export const isQuiet = (now) => { const h = et(now).hour; return h >= QUIET_FROM || h < QUIET_TO; };

// "7 PM", "7:30 PM" (ET).
export function fmtTime(ms) {
  const { hour, minute } = et(ms);
  const h12 = hour % 12 || 12, ampm = hour < 12 ? "AM" : "PM";
  return minute ? `${h12}:${String(minute).padStart(2, "0")} ${ampm}` : `${h12} ${ampm}`;
}
export function ago(iso, now) {
  const h = (now - Date.parse(iso)) / HOUR;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min ago`;
  if (h < 48) return `${Math.round(h)} h ago`;
  return `${Math.round(h / 24)} days ago`;
}
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const lastName = (name) => String(name).replace(/\s+(Jr\.|Sr\.|II|III|IV)$/, "").split(" ").pop();
const addDays = (date, n) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

// ---- Beat the Model ----

// Rudy's pick: before each day's first lock. Every game locks at its own kickoff, so on any ET day with open
// games, remind 2 h before the first one. Assumed (not asked): skip a day he's already picked a game on.
// `state` = beat-the-model's /api/state; "open" = has a frozen line and hasn't kicked off (isOpen in its rules.js).
export function btmAlerts(state, now) {
  const today = et(now).date;
  const onToday = (g) => et(Date.parse(g.start)).date === today;
  const open = state.games.filter((g) => g.line != null && now < Date.parse(g.start) && onToday(g));
  if (!open.length) return [];
  const first = Math.min(...open.map((g) => Date.parse(g.start)));
  if (now < first - 2 * HOUR) return [];
  if (state.games.some((g) => onToday(g) && state.picks?.[g.id]?.side)) return [];
  const n = open.length;
  return [{
    key: `btm:${today}`,
    title: "Beat the Model",
    body: n === 1 ? `1 game locks today at ${fmtTime(first)}. You haven't picked it.` : `${n} games lock today, the first at ${fmtTime(first)}. No picks yet.`,
    url: `${SITE}/beat-the-model/`,
  }];
}

// ---- King of the Court ----

// Promo nights only (Rudy's pick). The lock alert goes out once the night's first tip has passed (that's
// when kotc-tracker locks the picks); the result goes out the next morning, after quiet hours.
// `pred` = kotc-tracker's predictions-<season>.json. Pick and result wording mirror the hub's kotc tile.
export function kotcAlerts(pred, now) {
  const out = [];
  const { date: today, hour } = et(now);
  const nameOf = (pid) => pred.names?.[pid]?.n ?? String(pid);

  const d = pred.days?.[today];
  const tip = d && Date.parse(d.firstTip);
  // Within 3 h of the first tip, so a late first run doesn't announce picks for a night that's half over.
  if (d?.promo && d.picks?.length && now >= tip && now < tip + 3 * HOUR) {
    const win = Object.fromEntries((d.players ?? []).map((p) => [p.pid, p.win]));
    const picks = d.picks.map((pid) => `${lastName(nameOf(pid))}${win[pid] != null ? ` ${Math.round(win[pid] * 100)}%` : ""}`);
    const pool = d.pool ? `$${d.pool >= 1e6 ? `${d.pool / 1e6}M` : d.pool.toLocaleString("en-US")} pool · ` : "";
    out.push({
      key: `kotc-lock:${today}`,
      title: "King of the Court tonight",
      body: `${pool}${plural(d.games, "game")}. Picks: ${picks.join(", ")}.`,
      url: `${SITE}/kotc-tracker/`,
    });
  }

  // Results from the last two days only, so a first deploy doesn't announce old nights.
  if (hour >= QUIET_TO) {
    for (const day of Object.keys(pred.days ?? {}).sort()) {
      const p = pred.days[day], r = p.result;
      if (!p.promo || !r || day > today || day < addDays(today, -2)) continue;
      const kings = r.kings.map(nameOf);
      const hits = r.kings.filter((k) => p.picks?.includes(k)).map((k) => lastName(nameOf(k)));
      const n = p.picks?.length ?? 0;
      const headline = kings.length === 1 ? `${lastName(kings[0])} won` : `${kings.map(lastName).join(" & ")} tied`;
      const ours = !n ? "" : hits.length ? ` ${hits.join(" and ")} ${hits.length === 1 ? "was" : "were"} one of our ${n} picks.` : ` None of our ${n} picks won.`;
      out.push({
        key: `kotc-result:${day}`,
        title: `King of the Court · ${headline}`,
        body: `${kings.join(" and ")}, ${r.kingPra} PRA.${ours}`,
        url: `${SITE}/kotc-tracker/`,
      });
    }
  }
  return out;
}

// ---- UVA ----

// About an hour before a UVA football or men's basketball game: the cron runs every 15 minutes, so a
// 45–60 minute window catches every game exactly once. `teams` = [{ sport, data }], data = ESPN's
// teams/258 response, whose `team.nextEvent` is the next game (far smaller than the full schedule).
export function uvaAlerts(teams, now) {
  const out = [];
  for (const { sport, data } of teams) {
    for (const ev of data?.team?.nextEvent ?? []) {
      const c = ev.competitions?.[0];
      // A start time ESPN hasn't set yet comes as midnight with timeValid false.
      if (!c || c.timeValid === false || c.status?.type?.state !== "pre") continue;
      const start = Date.parse(ev.date), mins = (start - now) / MIN;
      if (!(mins > 45 && mins <= 60)) continue;
      const me = c.competitors.find((x) => x.id === "258"), opp = c.competitors.find((x) => x.id !== "258");
      const where = c.neutralSite || me?.homeAway === "home" ? "vs" : "at";
      const tv = c.broadcasts?.map((b) => b.media?.shortName).filter(Boolean)[0];
      const verb = sport === "Football" ? "Kicks off" : "Tips";
      out.push({
        key: `uva:${ev.id}`,
        title: `UVA ${where} ${opp?.team?.shortDisplayName ?? opp?.team?.displayName ?? "TBA"}`,
        body: `${verb} at ${fmtTime(start)}${tv ? ` on ${tv}` : ""}.`,
        url: `${SITE}/hub/daily.html`,
      });
    }
  }
  return out;
}

// ---- Data jobs ----

// A job that's failed or late by the Daily page's own rules (jobs.mjs). The key includes the run it's about,
// so the same failure alerts once, a new failure alerts again, and a stall alerts once until a run happens.
// `runsById` = { "<repo>/<file>": runs, newest first }.
export function jobProblems(runsById, now) {
  const out = [];
  for (const job of JOBS) {
    const id = `${job.repo}/${job.file}`, runs = runsById[id];
    if (!runs) continue; // couldn't fetch: say nothing rather than guess
    const status = jobStatus(job, runs, now);
    if (status !== "failed" && status !== "late") continue;
    const run = status === "failed" ? runs.find((r) => BAD_CONCLUSIONS.includes(r.conclusion)) : runs[0];
    out.push({
      key: `job:${id}:${status}:${run?.created_at ?? "none"}`,
      id, status, label: `${job.app} · ${job.name}`, lastRun: runs[0]?.created_at ?? null,
      url: status === "failed" && run?.html_url ? run.html_url : `${SITE}/hub/daily.html`,
    });
  }
  return out;
}

// What to send now for data jobs. `fresh` = problems not alerted before, `held` = ones that came up in quiet
// hours, `stillBad` = ids that are failed or late right now. In quiet hours everything is held; after, the
// held ones that are still broken go out with any new ones, as one summary when there's more than one.
export function planJobs({ fresh, held = [], stillBad, now }) {
  if (isQuiet(now)) return { alerts: [], held: [...held, ...fresh] };
  const byId = new Map();
  for (const p of [...held.filter((h) => stillBad.has(h.id)), ...fresh]) byId.set(p.id, p);
  const items = [...byId.values()];
  if (!items.length) return { alerts: [], held: [] };
  const word = (p) => (p.status === "failed" ? "failed" : "late");
  if (items.length === 1) {
    const p = items[0];
    return {
      held: [],
      alerts: [{ key: null, title: `Data job ${word(p)}`, body: `${p.label}. Last run ${p.lastRun ? ago(p.lastRun, now) : "never"}.`, url: p.url }],
    };
  }
  return {
    held: [],
    alerts: [{ key: null, title: `${items.length} data jobs need a look`, body: items.map((p) => `${p.label} (${word(p)})`).join("; ") + ".", url: `${SITE}/hub/daily.html` }],
  };
}
