// The Daily page: headlines, college scores, upsets and new YouTube videos.
// Headlines, upsets and videos come from data/, which the "Update daily data" workflow writes hourly
// (scripts/*.mjs). Scores come straight from ESPN, which allows browser requests, so they update live.

const ESPN = "https://site.api.espn.com/apis/site/v2/sports";
const UVA = "258"; // ESPN team id, the same in both sports
const LEAGUES = [
  // The default football board is already every FBS game (~0.8 MB on a Saturday).
  { key: "cfb", name: "College football", path: "football/college-football", queries: [""], acc: "1" },
  // The full Division I basketball board is ~1.7 MB on a busy day. The default board (games with a ranked
  // team) plus the ACC board cover the same filter at under a third of that.
  { key: "cbb", name: "College basketball", path: "basketball/mens-college-basketball", queries: ["", "&groups=2"], acc: "2" },
];
const MAX_GAMES = 10;
const LIVE_MS = 60 * 1000;
const LATER_MS = 10 * 60 * 1000; // games later today: picks up start-time changes and postponements
// The workflow doesn't run from midnight to 6 AM, so a 6-hour gap overnight is normal.
const STALE_HOURS = 8;
// A visit ends after 30 minutes away, so reloading mid-visit keeps the NEW badges.
const VISIT_GAP_MS = 30 * 60 * 1000;

// The page's own data sits next to it, so a relative fetch works on Pages and in local preview.
async function ownJson(path) {
  const res = await fetch(path, { cache: "no-cache" });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

const addDays = (key, n) => { const d = dayOf(key); d.setDate(d.getDate() + n); return new Intl.DateTimeFormat("en-CA").format(d); };
const dayWindow = () => { const today = todayET(); return [addDays(today, -1), today]; };
const dayLabel = (key) => { const [y, t] = dayWindow(); return key === t ? "Today" : key === y ? "Yesterday" : fmtDay(key); };
const late = (iso) => hoursSince(iso) > STALE_HOURS ? ` <span class="late">Running late</span>` : "";
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

function fill(id, { tag = "", hot = false, body, when = "" }) {
  const el = document.getElementById(id);
  el.querySelector(".tag").innerHTML = tag;
  el.querySelector(".tag").classList.toggle("hot", hot);
  if (body != null) el.querySelector(".tile-body").innerHTML = body;
  el.querySelector(".when").innerHTML = when;
  el.removeAttribute("aria-busy");
}

function failTile(id, e, message) {
  console.warn(`[daily] ${id}:`, e);
  document.getElementById(id).classList.add("failed");
  fill(id, { body: `<p class="label">${message}</p>` });
}

// ---- Headlines ----

async function renderNews() {
  try {
    const d = await ownJson("data/news.json");
    const sections = d.sections.map((s) => `<section>
      <h3>${esc(s.name)}</h3>
      <ol class="headlines">${s.items.map((x) => `<li>
        <a href="${esc(x.link)}" target="_blank" rel="noopener">${esc(x.title)}</a>
        <span class="meta">${esc(x.source)} · ${esc(ago(x.published))}</span></li>`).join("")}</ol>
    </section>`).join("");
    const failed = d.failed?.length ? `<p class="sub">${esc(d.failed.join(" and "))} didn't load on the last check, so ${d.failed.length === 1 ? "its" : "their"} headlines are from earlier.</p>` : "";
    fill("news", { body: `<div class="news">${sections}</div>${failed}`, when: `Updated ${esc(ago(d.updated))}${late(d.updated)}` });
  } catch (e) {
    failTile("news", e, "Couldn't load the headlines.");
  }
}

// ---- Scores ----

const boards = {}; // `${league}:${day}` → games

function gameOf(ev, lg) {
  const comp = ev.competitions[0];
  const teams = ["away", "home"].map((side) => comp.competitors.find((c) => c.homeAway === side)).map((c) => ({
    id: c.team.id,
    name: c.team.shortDisplayName ?? c.team.displayName,
    rank: c.curatedRank?.current <= 25 ? c.curatedRank.current : null,
    acc: c.team.conferenceId === lg.acc,
    score: c.score,
    winner: c.winner === true,
  }));
  const st = comp.status.type;
  return {
    id: ev.id,
    start: ev.date,
    timeValid: comp.timeValid !== false,
    state: st.state, // pre, in or post (post covers final, postponed and canceled)
    detail: st.shortDetail,
    link: ev.links?.find((x) => x.rel?.includes("summary"))?.href ?? ev.links?.[0]?.href ?? null,
    teams,
    uva: teams.some((t) => t.id === UVA),
    shown: teams.some((t) => t.id === UVA || t.rank || t.acc),
  };
}

async function loadBoard(lg, day) {
  const results = await Promise.all(lg.queries.map(async (q) => {
    const res = await fetch(`${ESPN}/${lg.path}/scoreboard?dates=${day.replaceAll("-", "")}&limit=400${q}`);
    if (!res.ok) throw new Error(`${lg.key} ${day}: HTTP ${res.status}`);
    return res.json();
  }));
  const byId = new Map(results.flatMap((r) => r.events ?? []).map((ev) => [ev.id, ev]));
  const order = { in: 0, pre: 1, post: 2 };
  return [...byId.values()].map((ev) => gameOf(ev, lg)).filter((g) => g.shown)
    .sort((a, b) => order[a.state] - order[b.state] || b.uva - a.uva || a.start.localeCompare(b.start));
}

function gameRow(g) {
  const status = g.state === "pre" ? (g.timeValid ? fmtTime(g.start) : "TBD") : g.detail;
  const team = (t) => `<span class="t${t.winner ? " w" : ""}${g.state === "post" && !t.winner && g.teams.some((x) => x.winner) ? " l" : ""}">${t.rank ? `<span class="rk">${t.rank}</span>` : ""}${esc(t.name)}</span>
    <span class="pts${t.winner ? " w" : ""}">${g.state === "pre" ? "" : esc(t.score)}</span>`;
  const inner = `${team(g.teams[0])}${team(g.teams[1])}<span class="st">${g.state === "in" ? `<span class="dot" aria-hidden="true"></span>` : ""}${esc(status)}</span>`;
  const label = `${g.teams.map((t) => `${t.rank ? `#${t.rank} ` : ""}${t.name}${g.state === "pre" ? "" : ` ${t.score}`}`).join(" at ")}, ${status}`;
  return `<li class="game ${g.state}${g.uva ? " uva" : ""}">${g.link
    ? `<a href="${esc(g.link)}" target="_blank" rel="noopener" aria-label="${esc(label)} (ESPN, new tab)">${inner}</a>`
    : `<div>${inner}</div>`}</li>`;
}

function renderLeague(lg) {
  const [yesterday, today] = dayWindow();
  const t = boards[`${lg.key}:${today}`] ?? [], y = boards[`${lg.key}:${yesterday}`] ?? [];
  // A Saturday has 20+ games, so the rest of a long day folds away (live games sort first, so they show).
  const list = (games, name) => `<ul class="games">${games.slice(0, MAX_GAMES).map(gameRow).join("")}</ul>${games.length > MAX_GAMES
    ? `<details class="more" data-name="${name}-more"><summary>Show ${games.length - MAX_GAMES} more</summary><ul class="games">${games.slice(MAX_GAMES).map(gameRow).join("")}</ul></details>` : ""}`;
  let body;
  if (!t.length && !y.length) body = `<p class="sub">No Top 25, UVA or ACC games yesterday or today.</p>`;
  else if (!t.length) body = `<h3 class="day">Yesterday</h3>${list(y, "yesterday")}`;
  else body = `<h3 class="day">Today</h3>${list(t, "today")}${y.length
    ? `<details class="older" data-name="yesterday"><summary class="day">Yesterday · ${plural(y.length, "game")}</summary>${list(y, "yesterday")}</details>` : ""}`;
  // Keep anything opened open across live refreshes.
  const tileEl = document.getElementById(`scores-${lg.key}`);
  const opened = [...tileEl.querySelectorAll("details[open]")].map((d) => d.dataset.name);
  const live = [...t, ...y].filter((g) => g.state === "in").length;
  fill(`scores-${lg.key}`, {
    tag: live ? `${live} live` : t.length ? `${t.length} today` : "",
    hot: live > 0,
    body,
    when: `Top 25, UVA and ACC${live ? " · updates every minute" : ""}`,
  });
  for (const d of tileEl.querySelectorAll("details")) if (opened.includes(d.dataset.name)) d.open = true;
}

const timers = {};
async function refreshLeague(lg) {
  clearTimeout(timers[lg.key]);
  const days = dayWindow();
  try {
    // A day is fetched again until every game on it is over.
    await Promise.all(days.map(async (day) => {
      const k = `${lg.key}:${day}`;
      if (!boards[k] || boards[k].some((g) => g.state !== "post")) boards[k] = await loadBoard(lg, day);
    }));
    renderLeague(lg);
  } catch (e) {
    if (!days.some((d) => boards[`${lg.key}:${d}`])) return failTile(`scores-${lg.key}`, e, "Couldn't reach ESPN for scores.");
    console.warn(`[daily] ${lg.key} refresh failed; showing the last scores:`, e);
  }
  const games = days.flatMap((d) => boards[`${lg.key}:${d}`] ?? []);
  const now = Date.now();
  const due = games.some((g) => g.state === "in" || (g.state === "pre" && new Date(g.start) <= now));
  const later = games.some((g) => g.state === "pre");
  if (due || later) timers[lg.key] = setTimeout(() => whenVisible(() => refreshLeague(lg)), due ? LIVE_MS : LATER_MS);
}

// Don't poll ESPN from a background tab; catch up as soon as it's visible again.
const waiting = new Set();
function whenVisible(fn) {
  if (!document.hidden) return fn();
  waiting.add(fn);
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  for (const fn of waiting) fn();
  waiting.clear();
});

// ---- Markets ----

// CNBC's quote service allows browser requests, so quotes update live with no workflow. Outside regular
// hours it returns the last session's close and change, which is what the tile shows (Rudy's choice).
// Its `curmktstatus` can't say whether the market is open: the indexes still read REG_MKT at 7:30 PM, so
// the clock decides instead.
const QUOTES_URL = `https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?${new URLSearchParams({
  symbols: ".SPX|.IXIC", requestMethod: "itv", noform: "1", partnerId: "2", fund: "1", exthrs: "1", output: "json", events: "1",
})}`;
const INDEXES = [[".SPX", "S&P 500"], [".IXIC", "Nasdaq"]]; // Nasdaq = the Composite, as in the news
const CLOSED_MS = 10 * 60 * 1000;

// Weekdays 9:30 AM–4 PM Eastern. Holidays aren't listed: on one, the newest quote is from an earlier day,
// so the tile still says Closed (it just polls every minute until 4).
function inMarketHours(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23",
  }).formatToParts(now).map((p) => [p.type, p.value]));
  const mins = Number(parts.hour) * 60 + Number(parts.minute);
  return !["Sat", "Sun"].includes(parts.weekday) && mins >= 9 * 60 + 30 && mins < 16 * 60;
}

// CNBC sends strings with up to 3 decimals ("25,955.162"); show 2, with a real minus sign.
const num2 = (s) => Number(String(s).replace(/,/g, "")).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signed2 = (s) => { const n = Number(String(s).replace(/,/g, "")); return `${n < 0 ? "−" : n > 0 ? "+" : ""}${num2(Math.abs(n))}`; };

let quotesShown = false;
async function refreshMarkets() {
  clearTimeout(timers.markets);
  const hours = inMarketHours();
  try {
    const res = await fetch(QUOTES_URL);
    if (!res.ok) throw new Error(`quotes: HTTP ${res.status}`);
    const quotes = (await res.json()).FormattedQuoteResult.FormattedQuote;
    const bySymbol = Object.fromEntries(quotes.map((q) => [q.symbol, q]));
    const rows = INDEXES.map(([symbol, name]) => ({ name, q: bySymbol[symbol] }));
    if (rows.some((r) => !r.q?.change_pct)) throw new Error("quotes: an index is missing");
    const cells = rows.map(({ name, q }) => {
      const dir = q.changetype === "UP" ? "up" : q.changetype === "DOWN" ? "down" : "flat";
      const arrow = { up: "▲", down: "▼", flat: "" }[dir];
      return `<div class="index ${dir}">
        <p class="ix-name">${esc(name)}</p>
        <p class="ix-pct"><span aria-hidden="true">${arrow}</span> ${esc(q.change_pct.replace(/^[+-]/, ""))}<span class="visually-hidden"> ${dir}</span></p>
        <p class="ix-sub">${esc(signed2(q.change))} · ${esc(num2(q.last))}</p>
      </div>`;
    }).join("");
    const asOf = rows[0].q.last_time;
    const session = etDate(new Date(asOf));
    const open = hours && session === todayET();
    const closeLabel = session === todayET() ? "Today's close" : `${dayOf(session).toLocaleDateString(undefined, { weekday: "long" })}'s close`;
    fill("markets", {
      tag: open ? "Live" : "Closed",
      hot: open,
      body: `<div class="indexes">${cells}</div>`,
      when: open ? `As of ${esc(fmtTime(asOf))} · updates every minute` : closeLabel,
    });
    quotesShown = true;
  } catch (e) {
    if (!quotesShown) failTile("markets", e, "Couldn't load market quotes.");
    else console.warn("[daily] markets refresh failed; showing the last quotes:", e);
  }
  timers.markets = setTimeout(() => whenVisible(refreshMarkets), hours ? LIVE_MS : CLOSED_MS);
}

// ---- Upsets ----

async function renderUpsets() {
  try {
    const d = await ownJson("data/upsets.json");
    const days = dayWindow();
    // The file can be from before midnight, so keep only games in today's window.
    const rows = d.upsets.filter((u) => days.includes(u.date));
    const leagueName = Object.fromEntries(LEAGUES.map((lg) => [lg.key, lg.name]));
    const who = (s) => `${s.rank ? `#${s.rank} ` : ""}${esc(s.name)}`;
    const list = rows.length
      ? `<ol class="upset-list">${rows.map((u) => `<li>
          <a href="${esc(u.link ?? "#")}" target="_blank" rel="noopener"><b>${who(u.winner)}</b> <span class="line">+${u.line}</span> beat ${who(u.loser)}, ${u.winner.score}–${u.loser.score}</a>
          <span class="meta">${esc(leagueName[u.league])} · ${esc(dayLabel(u.date))}</span></li>`).join("")}</ol>`
      : `<p class="label">No ${d.minLine}+ point underdog has won yesterday or today.</p>`;
    fill("upsets", {
      tag: rows.length ? `${rows.length}` : "",
      hot: rows.length > 0,
      body: `<p class="kicker">Underdogs of ${d.minLine}+ points that won outright, in any FBS or Division I game. Lines are DraftKings', via ESPN.</p>${list}`,
      when: `Checked hourly · updated ${esc(ago(d.updated))}${late(d.updated)}`,
    });
  } catch (e) {
    failTile("upsets", e, "Couldn't load the upsets.");
  }
}

// ---- YouTube ----

// When the previous visit ended (on this device). The first visit counts the last day as new.
function lastVisit() {
  const KEY = "hub:daily:visit";
  const now = Date.now();
  let v = null;
  try { v = JSON.parse(localStorage.getItem(KEY)); } catch {}
  if (!v) v = { since: now - 864e5, seen: now };
  else if (now - v.seen > VISIT_GAP_MS) v.since = v.seen;
  v.seen = now;
  try { localStorage.setItem(KEY, JSON.stringify(v)); } catch {}
  return v.since;
}

async function renderYoutube() {
  let d;
  try {
    d = await ownJson("data/youtube.json");
  } catch {
    return; // not set up yet: the tile stays hidden
  }
  const el = document.getElementById("youtube");
  el.hidden = false;
  const since = lastVisit();
  const chans = d.channels.map((c) => ({ ...c, fresh: c.videos.filter((v) => new Date(v.seen) > since).length }))
    .sort((a, b) => (b.fresh > 0) - (a.fresh > 0) || (b.videos[0]?.published ?? "").localeCompare(a.videos[0]?.published ?? ""));
  const fresh = chans.filter((c) => c.fresh).length;
  const cards = chans.map((c) => {
    const v = c.videos[0];
    const href = v ? `https://www.youtube.com/watch?v=${encodeURIComponent(v.id)}` : `https://www.youtube.com/channel/${encodeURIComponent(c.id)}`;
    return `<li class="channel${c.fresh ? " fresh" : ""}"><a href="${href}" target="_blank" rel="noopener">
      ${v?.thumb ? `<img src="${esc(v.thumb)}" alt="" loading="lazy" width="320" height="180">` : `<span class="no-thumb"></span>`}
      <span class="ch">${esc(c.name)}${c.fresh ? ` <span class="badge">${c.fresh > 1 ? `${c.fresh} new` : "New"}</span>` : ""}</span>
      <span class="vt">${v ? esc(v.title) : "No full-length videos yet"}</span>
      ${v ? `<span class="meta">${esc(ago(v.published))}</span>` : ""}
    </a></li>`;
  }).join("");
  const failed = d.failed?.length ? `<p class="sub">Couldn't check ${esc(d.failed.join(", "))} last time; showing what was there before.</p>` : "";
  fill("youtube", {
    tag: fresh ? `${fresh} new` : "",
    hot: fresh > 0,
    body: `<p class="kicker">Newest full-length upload per channel. New means it showed up since your last visit on this device.</p><ul class="channels">${cards}</ul>${failed}`,
    when: `Updated ${esc(ago(d.updated))}${late(d.updated)}`,
  });
}

function renderDaily() {
  document.getElementById("subline").textContent = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  refreshMarkets();
  renderNews();
  renderUpsets();
  renderYoutube();
  LEAGUES.forEach(refreshLeague);
}
