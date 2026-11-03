// Starts GitHub Actions workflows on a Cloudflare Cron Trigger, because GitHub's own schedule skips
// runs and starts others hours late (3 of ~10 hourly hub runs on 2026-10-23; cfb-picks' Saturday 9 AM
// odds snapshot at 1:27 PM on 2026-10-31, after the noon kickoffs). Data that's only available
// before a game starts (closing lines, a pre-tip prediction) is lost when a run comes too late.
// Each workflow keeps its GitHub cron as a fallback.
//
// No fetch handler on purpose: the Worker has no URL, so nobody else can trigger runs.
// GITHUB_TOKEN is a fine-grained token limited to the repos below, with Actions: read and write.
//
// One cron trigger (:20 and :50 every hour, UTC) and a schedule in Eastern time here, so the times
// don't shift with daylight saving and the Worker stays within the free plan's cron trigger limit.

const OWNER = "mattrudy13";

// Days: 0 = Sunday … 6 = Saturday (ET). Months: 1–12 (ET). Hours are ET, 0–23.
const JOBS = [
  {
    // The Daily page's hourly refresh, 6:20 AM to 12:20 AM.
    repo: "hub", workflow: "update-daily.yml",
    at: (t) => t.minute === 20 && (t.hour >= 6 || t.hour === 0),
  },
  {
    // Sunday 9 PM (lines near the opener), Tuesday and Friday 10 AM, Saturday 9 AM (the close for most
    // games). Beat the Model freezes Tuesday's lines from this snapshot. Bowls and the CFP are in
    // scope but play on any day, so they'll need their own times here (not done yet).
    repo: "cfb-picks", workflow: "snapshot-odds.yml", months: [8, 9, 10, 11, 12],
    at: (t) => t.minute === 20 && ((t.day === 0 && t.hour === 21) || ((t.day === 2 || t.day === 5) && t.hour === 10) || (t.day === 6 && t.hour === 9)),
  },
  {
    // Thursday 10 AM (before TNF) and Sunday 3 AM (before the London games). The workflow skips a run
    // that comes within 12 h of the last snapshot, so this and GitHub's cron don't both spend ~45 credits.
    repo: "te-tracker", workflow: "snapshot-odds.yml", months: [9, 10, 11, 12, 1, 2], inputs: { source: "worker" },
    at: (t) => t.minute === 20 && ((t.day === 4 && t.hour === 10) || (t.day === 0 && t.hour === 3)),
  },
  {
    // Predictions lock at the night's first tip (usually 7 PM ET; earlier on some weekends and
    // holidays). 10:20 AM–4:20 PM every 2 h, then 5:20, 6:20 and 6:50 PM for late injury news.
    repo: "kotc-tracker", workflow: "update-data.yml", months: [10, 11, 12, 1, 2, 3, 4],
    at: (t) => (t.minute === 20 && [10, 12, 14, 16, 17, 18].includes(t.hour)) || (t.minute === 50 && t.hour === 18),
  },
];

// The current time in Eastern time, rounded to the cron minute (Cloudflare can fire a few seconds late).
export function easternTime(ms) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York", hourCycle: "h23",
      month: "numeric", weekday: "short", hour: "numeric", minute: "numeric",
    }).formatToParts(new Date(ms)).map((p) => [p.type, p.value]),
  );
  const days = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { month: Number(parts.month), day: days[parts.weekday], hour: Number(parts.hour), minute: Number(parts.minute) };
}

export function jobsDue(t) {
  return JOBS.filter((j) => (!j.months || j.months.includes(t.month)) && j.at(t));
}

async function dispatch(job, token) {
  const res = await fetch(`https://api.github.com/repos/${OWNER}/${job.repo}/actions/workflows/${job.workflow}/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "hub-daily-cron", // GitHub rejects requests without one
    },
    body: JSON.stringify({ ref: "main", ...(job.inputs ? { inputs: job.inputs } : {}) }),
  });
  // 204 = queued.
  if (res.status !== 204) throw new Error(`${job.repo}/${job.workflow}: HTTP ${res.status} ${await res.text()}`);
  console.log(`started ${job.repo}/${job.workflow}`);
}

export default {
  async scheduled(controller, env) {
    const due = jobsDue(easternTime(controller.scheduledTime));
    // One failed dispatch (say, a repo missing from the token) shouldn't stop the others.
    const results = await Promise.allSettled(due.map((job) => dispatch(job, env.GITHUB_TOKEN)));
    const failed = results.filter((r) => r.status === "rejected").map((r) => r.reason.message);
    // Throwing marks the cron run as failed in the Cloudflare dashboard, with GitHub's error in the logs.
    if (failed.length) throw new Error(`workflow dispatch failed: ${failed.join("; ")}`);
  },
};
