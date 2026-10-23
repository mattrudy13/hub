// Starts hub's "Update daily data" workflow on a Cloudflare Cron Trigger, because GitHub's own
// schedule skipped most hourly runs (3 of ~10 on 2026-10-23). The workflow keeps its GitHub cron as a
// fallback; a doubled run is harmless (it only commits when the data changed).
//
// No fetch handler on purpose: the Worker has no URL, so nobody else can trigger runs.
// GITHUB_TOKEN is a fine-grained token limited to mattrudy13/hub with Actions: read and write.

const DISPATCH_URL = "https://api.github.com/repos/mattrudy13/hub/actions/workflows/update-daily.yml/dispatches";

export default {
  async scheduled(controller, env) {
    const res = await fetch(DISPATCH_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "hub-daily-cron", // GitHub rejects requests without one
      },
      body: JSON.stringify({ ref: "main" }),
    });
    // 204 = queued. Throwing marks the cron run as failed in the Cloudflare dashboard.
    if (res.status !== 204) throw new Error(`workflow dispatch failed: HTTP ${res.status} ${await res.text()}`);
  },
};
