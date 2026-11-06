// hub-push: push notifications for Rudy's Board (just Rudy's devices; a passphrase guards sign-up).
//
// - POST /subscribe   { key, subscription }  key must equal the PUSH_KEY secret. Saves the phone's subscription.
// - POST /unsubscribe { endpoint }
// - POST /test        { endpoint }  sends "Alerts are working" to that subscription, at most once a minute.
// - GET  /config      the VAPID public key, for the page's subscribe() call.
// Knowing an endpoint (a long, unguessable push-service URL) is the proof for unsubscribe and test, so the
// passphrase is typed once per device.
//
// Cron, every 15 minutes: the checks in checks.js (Beat the Model, KOTC, UVA, data jobs). Each alert's key is
// saved in KV for 30 days once sent, so nothing goes out twice. Data-job alerts in quiet hours wait in KV.
//
// Secrets: PUSH_KEY, VAPID_PRIVATE (the key's d, base64url), GITHUB_TOKEN (read-only, public repos).
// Vars (wrangler.toml): VAPID_PUBLIC, ALLOWED_ORIGINS. For local runs only: DRY_RUN=1 logs instead of
// sending, NOW=<iso> pretends it's another time (both in .dev.vars).

import { sendPush, b64u } from "./webpush.js";
import { btmAlerts, kotcAlerts, uvaAlerts, jobProblems, planJobs } from "./checks.js";
import { JOBS, runsUrl, slimRun } from "../../jobs.mjs";

const SUBJECT = "https://mattrudy13.github.io/hub/"; // VAPID contact: the site, not an email address
const SENT_TTL = 30 * 864e2; // seconds
const UA = "hub-push (mattrudy13.github.io/hub)";
// Push services browsers use. Anything else is refused, so the Worker can't be told to POST elsewhere.
const PUSH_HOSTS = [/^web\.push\.apple\.com$/, /^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/];

const nowOf = (env) => (env.NOW ? Date.parse(env.NOW) : Date.now());
const hashOf = async (s) => b64u(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
const vapidOf = (env) => ({ publicKey: env.VAPID_PUBLIC, privateKey: env.VAPID_PRIVATE });

export default {
  async scheduled(controller, env) {
    await runChecks(env, env.NOW ? nowOf(env) : controller.scheduledTime);
  },

  async fetch(req, env) {
    const origin = req.headers.get("Origin") ?? "";
    const allowed = env.ALLOWED_ORIGINS.split(",").includes(origin) || /^http:\/\/localhost(:\d+)?$/.test(origin);
    const cors = allowed ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "GET, POST", Vary: "Origin" } : {};
    if (req.method === "OPTIONS") return new Response(null, { status: allowed ? 204 : 403, headers: cors });
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors } });
    const path = new URL(req.url).pathname;

    try {
      if (req.method === "GET" && path === "/config") return json({ vapidPublicKey: env.VAPID_PUBLIC });
      if (req.method !== "POST") return json({ error: "Not found" }, 404);
      const body = await req.json().catch(() => ({}));

      if (path === "/subscribe") {
        if (!(await sameSecret(body.key, env.PUSH_KEY))) return json({ error: "Wrong passphrase" }, 401);
        const sub = cleanSubscription(body.subscription);
        if (!sub) return json({ error: "That isn't a push subscription this Worker accepts" }, 400);
        await env.KV.put(`sub:${await hashOf(sub.endpoint)}`, JSON.stringify({ ...sub, at: new Date().toISOString() }));
        return json({ ok: true });
      }
      if (path === "/unsubscribe") {
        if (typeof body.endpoint === "string") await env.KV.delete(`sub:${await hashOf(body.endpoint)}`);
        return json({ ok: true });
      }
      if (path === "/test") {
        if (typeof body.endpoint !== "string") return json({ error: "Missing endpoint" }, 400);
        const h = await hashOf(body.endpoint);
        const sub = await env.KV.get(`sub:${h}`, "json");
        if (!sub) return json({ error: "This device isn't signed up" }, 404);
        if (await env.KV.get(`test:${h}`)) return json({ error: "One test a minute" }, 429);
        await env.KV.put(`test:${h}`, "1", { expirationTtl: 60 });
        const status = await sendPush(sub, { title: "Rudy's Board", body: "Alerts are working.", url: SITE_HUB }, vapidOf(env), SUBJECT);
        if (status === 404 || status === 410) await env.KV.delete(`sub:${h}`);
        return json({ ok: status >= 200 && status < 300, status }, status >= 200 && status < 300 ? 200 : 502);
      }
      return json({ error: "Not found" }, 404);
    } catch (e) {
      console.error(e);
      return json({ error: "Something went wrong" }, 500);
    }
  },
};

const SITE_HUB = "https://mattrudy13.github.io/hub/";

// Constant-time comparison, so response timing doesn't hint at the passphrase.
async function sameSecret(given, secret) {
  if (typeof given !== "string" || !secret) return false;
  const [a, b] = await Promise.all([given, secret].map((s) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))));
  return crypto.subtle.timingSafeEqual(a, b);
}

function cleanSubscription(s) {
  try {
    const u = new URL(s.endpoint);
    if (u.protocol !== "https:" || !PUSH_HOSTS.some((re) => re.test(u.hostname))) return null;
    if (typeof s.keys?.p256dh !== "string" || typeof s.keys?.auth !== "string") return null;
    return { endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } };
  } catch {
    return null;
  }
}

// ---- Cron ----

async function getJson(url, init) {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

// NBA season = the year it starts (Aug–Dec: this year; Jan–Jul: last year), the hub's rule.
const nbaSeason = (now) => { const d = new Date(now); return d.getUTCMonth() >= 7 ? d.getUTCFullYear() : d.getUTCFullYear() - 1; };

async function runChecks(env, now) {
  const subs = [];
  for (const k of (await env.KV.list({ prefix: "sub:" })).keys) {
    const s = await env.KV.get(k.name, "json");
    if (s) subs.push({ kvKey: k.name, ...s });
  }
  if (!subs.length && !env.DRY_RUN) return; // nobody to tell; don't spend the API calls

  const alerts = [], errors = [];
  // Each source on its own: ESPN being down shouldn't stop the KOTC result.
  const tryCheck = async (name, fn) => {
    try { alerts.push(...(await fn())); } catch (e) { errors.push(`${name}: ${e.message}`); }
  };

  await Promise.all([
    // A Worker can't fetch another workers.dev Worker on the same account, so this goes through a service binding.
    tryCheck("btm", async () => {
      const res = await env.BTM.fetch("https://beat-the-model/api/state");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return btmAlerts(await res.json(), now);
    }),
    tryCheck("kotc", async () => kotcAlerts(await getJson(`https://mattrudy13.github.io/kotc-tracker/data/predictions-${nbaSeason(now)}.json`), now)),
    tryCheck("uva", async () => {
      const espn = "https://site.api.espn.com/apis/site/v2/sports";
      const teams = await Promise.all([["Basketball", "basketball/mens-college-basketball"], ["Football", "football/college-football"]]
        .map(async ([sport, path]) => ({ sport, data: await getJson(`${espn}/${path}/teams/258`) })));
      return uvaAlerts(teams, now);
    }),
    tryCheck("jobs", () => jobAlerts(env, now)),
  ]);

  for (const a of alerts) {
    if (a.key && (await env.KV.get(`sent:${a.key}`))) continue;
    if (env.DRY_RUN) { console.log("[dry run] would send:", JSON.stringify(a)); continue; }
    await sendToAll(env, subs, a);
    if (a.key) await env.KV.put(`sent:${a.key}`, new Date(now).toISOString(), { expirationTtl: SENT_TTL });
  }
  // Throwing marks the run failed in the Cloudflare dashboard, with the reason in the logs.
  if (errors.length) throw new Error(`checks failed: ${errors.join("; ")}`);
}

// Data jobs: new problems are marked as seen right away (so they're never alerted twice), then either sent or
// held for quiet hours. Returns the alerts to send now (with key null: they're already marked).
async function jobAlerts(env, now) {
  const runsById = {};
  await Promise.all(JOBS.map(async (job) => {
    const data = await getJson(runsUrl(job), {
      // Without a token (local dry runs) GitHub still answers, at its lower anonymous limit.
      headers: { ...(env.GITHUB_TOKEN ? { Authorization: `Bearer ${env.GITHUB_TOKEN}` } : {}), Accept: "application/vnd.github+json", "User-Agent": UA },
    });
    runsById[`${job.repo}/${job.file}`] = (data.workflow_runs ?? []).map(slimRun);
  }));
  const problems = jobProblems(runsById, now);
  const fresh = [];
  for (const p of problems) if (!(await env.KV.get(`sent:${p.key}`))) fresh.push(p);
  const held = (await env.KV.get("held:jobs", "json")) ?? [];
  const plan = planJobs({ fresh, held, stillBad: new Set(problems.map((p) => p.id)), now });
  if (env.DRY_RUN) {
    console.log("[dry run] job problems:", JSON.stringify(problems), "held:", JSON.stringify(plan.held));
    return plan.alerts;
  }
  for (const p of fresh) await env.KV.put(`sent:${p.key}`, new Date(now).toISOString(), { expirationTtl: SENT_TTL });
  if (JSON.stringify(plan.held) !== JSON.stringify(held)) await env.KV.put("held:jobs", JSON.stringify(plan.held));
  return plan.alerts;
}

async function sendToAll(env, subs, alert) {
  const message = { title: alert.title, body: alert.body, url: alert.url };
  await Promise.all(subs.map(async (s) => {
    try {
      const status = await sendPush(s, message, vapidOf(env), SUBJECT);
      // 404/410: the browser dropped this subscription (app removed, permission revoked).
      if (status === 404 || status === 410) await env.KV.delete(s.kvKey);
      else if (status >= 300) console.warn(`push to ${new URL(s.endpoint).hostname}: HTTP ${status}`);
    } catch (e) {
      console.warn("push failed:", e.message);
    }
  }));
  console.log(`sent "${alert.title}" to ${subs.length} device(s)`);
}
