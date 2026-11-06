// The scheduled jobs that keep the apps' data fresh, and the rule for whether each one is OK, failed or late.
// Shared by the Daily page's Data Jobs tile (daily.js imports it) and the push Worker (push/ bundles it),
// so one lateHours edit changes the tile and the alerts together.
//
// lateHours = the longest gap in the job's cron schedule (UTC) plus slack, because GitHub starts scheduled
// runs hours late and skips some. months = the months its cron runs in.
// worker = hub's cron Worker (worker/src/index.js) also starts it, so its row says who started the last run.
export const JOBS = [
  // Every 3 h Thu–Mon and Tue 10:00: Tue 10:00 → Thu 00:00 is 38 h.
  { app: "NFL Tight End TDs", repo: "te-tracker", file: "update-data.yml", name: "Update data", months: [9, 10, 11, 12, 1, 2], lateHours: 50 },
  // Thu 15:00 and Sun 08:00: Sun → Thu is 103 h.
  { app: "NFL Tight End TDs", repo: "te-tracker", file: "snapshot-odds.yml", name: "Snapshot odds", months: [9, 10, 11, 12, 1, 2], lateHours: 115, worker: true },
  // Saturday into Sunday every 3 h, then Mon and Wed mornings: Wed → Sat is 78 h.
  { app: "College Football Picks", repo: "cfb-picks", file: "update-data.yml", name: "Update data", months: [8, 9, 10, 11, 12], lateHours: 90 },
  // Mon 01:00, Tue and Fri 14:00, Sat 13:00: Tue → Fri is 72 h.
  { app: "College Football Picks", repo: "cfb-picks", file: "snapshot-odds.yml", name: "Snapshot odds", months: [8, 9, 10, 11, 12], lateHours: 84, worker: true },
  // Every 2 h.
  { app: "King of the Court", repo: "kotc-tracker", file: "update-data.yml", name: "Update data", months: [10, 11, 12, 1, 2, 3, 4], lateHours: 10, worker: true },
  // 08:15, 14:15, 17:15 and 21:15: overnight is 11 h.
  { app: "NBA First Minute", repo: "nba-first-minute", file: "update-data.yml", name: "Update data", months: [10, 11, 12, 1, 2, 3, 4], lateHours: 24 },
  // Daily at 09:00.
  { app: "UVA Records", repo: "uva-records", file: "refresh.yml", name: "Refresh data", months: null, lateHours: 36 },
  // Hourly 10:20–04:20 (the cron Worker plus GitHub's schedule): overnight is 6 h.
  { app: "Rudy's Daily", repo: "hub", file: "update-daily.yml", name: "Update daily data", months: null, lateHours: 9, worker: true },
];

export const BAD_CONCLUSIONS = ["failure", "timed_out", "startup_failure"];

// When the job's current run of cron months began (UTC), so a job isn't late before its first run of the season.
export function seasonStart(months, now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  for (let i = 0; i < 12 && months.includes(((d.getUTCMonth() + 11) % 12) + 1); i++) d.setUTCMonth(d.getUTCMonth() - 1);
  return d;
}

// runs = newest first, each { status, conclusion, created_at }. Returns failed | running | late | starting | ok | off.
export function jobStatus(job, runs, now = Date.now()) {
  const newest = runs[0];
  // Cancelled and skipped runs say nothing about whether the job works.
  const done = runs.find((r) => r.status === "completed" && !["cancelled", "skipped"].includes(r.conclusion));
  const inSeason = !job.months || job.months.includes(new Date(now).getUTCMonth() + 1);
  if (!inSeason) return "off";
  if (done && BAD_CONCLUSIONS.includes(done.conclusion)) return "failed";
  if (newest && newest.status !== "completed") return "running";
  const lateMs = job.lateHours * 3600e3;
  if (!newest || now - new Date(newest.created_at) > lateMs) {
    if (job.months && now - seasonStart(job.months, new Date(now)) < lateMs) return "starting";
    return "late";
  }
  return "ok";
}

// The GitHub API URL for a job's recent runs (5 is enough to skip past a cancelled or running one).
export const runsUrl = (job) =>
  `https://api.github.com/repos/mattrudy13/${job.repo}/actions/workflows/${job.file}/runs?per_page=5&exclude_pull_requests=true`;

// The fields both callers keep from a workflow run.
export const slimRun = (r) => ({ status: r.status, conclusion: r.conclusion, created_at: r.created_at, html_url: r.html_url, event: r.event });
