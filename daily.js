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
  const foot = el.querySelector(".when"); // Coming Up has no footer
  if (foot) foot.innerHTML = when;
  el.removeAttribute("aria-busy");
}

// The shared row's widths depend on how many of its tiles are showing (see .row-tile in style.css).
function arrangeRow() {
  const main = document.querySelector("main.daily");
  const shown = [...main.querySelectorAll(".row-tile")].filter((t) => !t.hidden);
  main.dataset.row = shown.length;
  shown.forEach((t, i) => t.classList.toggle("row-last-odd", shown.length % 2 === 1 && i === shown.length - 1));
}

function failTile(id, e, message) {
  console.warn(`[daily] ${id}:`, e);
  document.getElementById(id).classList.add("failed");
  fill(id, { body: `<p class="label">${message}</p>` });
}

// ---- Headlines ----

// Tabs (headlines on a phone, and the Top 25's sports): the last one picked is remembered on this device.
// Returns pick(key), which shows that tab's panel; onPick runs after, for anything else that follows the tab.
function makeTabs(id, storeKey, onPick) {
  const root = document.getElementById(id);
  const pick = (key) => {
    for (const b of root.querySelectorAll("[role=tab]")) {
      const on = b.dataset.key === key;
      b.setAttribute("aria-selected", on);
      b.tabIndex = on ? 0 : -1;
      document.getElementById(b.getAttribute("aria-controls")).classList.toggle("off", !on);
    }
    try { localStorage.setItem(storeKey, key); } catch {}
    onPick?.(key);
  };
  root.addEventListener("click", (e) => {
    const b = e.target.closest("[role=tab]");
    if (b) pick(b.dataset.key);
  });
  // Arrow keys move between tabs (the standard tabs pattern).
  root.addEventListener("keydown", (e) => {
    if (!e.target.matches("[role=tab]") || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    const all = [...root.querySelectorAll("[role=tab]")];
    const i = all.indexOf(e.target);
    const next = all[{ ArrowLeft: (i - 1 + all.length) % all.length, ArrowRight: (i + 1) % all.length, Home: 0, End: all.length - 1 }[e.key]];
    e.preventDefault();
    pick(next.dataset.key);
    next.focus();
  });
  return pick;
}
const savedTab = (storeKey) => { try { return localStorage.getItem(storeKey); } catch { return null; } };

const TAB_KEY = "hub:daily:newsTab";
const pickTab = makeTabs("news", TAB_KEY);

async function renderNews() {
  try {
    const d = await ownJson("data/news.json");
    let tab = savedTab(TAB_KEY);
    if (!d.sections.some((s) => s.key === tab)) tab = d.sections[0]?.key;
    const tabs = `<div class="news-tabs" role="tablist" aria-label="Headline sections">${d.sections.map((s) =>
      `<button type="button" role="tab" id="tab-${esc(s.key)}" aria-controls="panel-${esc(s.key)}" data-key="${esc(s.key)}">${esc(s.name)}</button>`).join("")}</div>`;
    const sections = d.sections.map((s) => `<section id="panel-${esc(s.key)}" role="tabpanel" aria-labelledby="tab-${esc(s.key)}">
      <h3>${esc(s.name)}</h3>
      <ol class="headlines">${s.items.map((x) => `<li>
        <a href="${esc(safeUrl(x.link) ?? "#")}" target="_blank" rel="noopener">${esc(x.title)}</a>
        <span class="meta">${esc(x.source)} · ${esc(ago(x.published))}</span></li>`).join("")}</ol>
    </section>`).join("");
    const failed = d.failed?.length ? `<p class="sub">${esc(d.failed.join(" and "))} didn't load on the last check, so ${d.failed.length === 1 ? "its" : "their"} headlines are from earlier.</p>` : "";
    fill("news", { body: `${tabs}<div class="news">${sections}</div>${failed}`, when: `Updated ${esc(ago(d.updated))}${late(d.updated)}` });
    pickTab(tab);
  } catch (e) {
    failTile("news", e, "Couldn't load the headlines.");
  }
}

// ---- Scores ----

const boards = {}; // `${league}:${day}` → games

function gameOf(ev, lg) {
  const comp = ev.competitions[0];
  const teams = ["away", "home"].map((side) => comp.competitors.find((c) => c.homeAway === side)).map((c) => ({
    side: c.homeAway,
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
    league: lg.key,
    start: ev.date,
    timeValid: comp.timeValid !== false,
    state: st.state, // pre, in or post (post covers final, postponed and canceled)
    detail: st.shortDetail,
    link: ev.links?.find((x) => x.rel?.includes("summary"))?.href ?? ev.links?.[0]?.href ?? null,
    // The first network is the main one ("ESPN" from ["ESPN", "Disney+"]).
    tv: comp.broadcasts?.[0]?.names?.[0] ?? null,
    // DraftKings' line as ESPN words it ("MIA -20.5"); ESPN drops it once the game is final.
    line: comp.odds?.[0]?.details ? minus(comp.odds[0].details.replace(" -", " −")) : null,
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
  return [...byId.values()].map((ev) => gameOf(ev, lg))
    .sort((a, b) => order[a.state] - order[b.state] || b.uva - a.uva || a.start.localeCompare(b.start));
}

// Boards keep every game; the tiles show Top 25, UVA and ACC games plus any game cfb-picks has a pick on.
// That's decided at render time because the picks can arrive after the scores.
const visible = (games = []) => games.filter((g) => g.shown || (g.league === "cfb" && cfbPicks.has(g.id)));

// ---- cfb-picks badges ----

// The current model's official spread picks, by ESPN event id (cfb-picks' gameId). Same rule as the hub's
// cfb tile (tiles.js): the current model is the newest pick's.
const cfbPicks = new Map();
async function loadPicks() {
  try {
    const { data } = await getSeason((y) => `cfb-picks/data/picks-${y}.json`);
    const all = Object.values(data.weeks ?? {}).flatMap((w) => w.picks);
    const model = [...all].sort((a, b) => b.takenAt.localeCompare(a.takenAt))[0]?.model ?? "v2";
    for (const p of all) if ((p.model ?? "v2") === model && !p.shadow && p.cat === "spread") cfbPicks.set(String(p.gameId), p);
  } catch (e) {
    console.warn("[daily] cfb picks didn't load; scores show without them:", e);
  }
}

const fmtLine = (x) => x === 0 ? "PK" : `${x < 0 ? "−" : "+"}${Math.abs(x)}`;

// "Model: Oregon −7.5", then covering or not while it's on, and the result once it's final.
function pickBadge(g) {
  const p = g.league === "cfb" && cfbPicks.get(g.id);
  if (!p) return null;
  const mine = g.teams.find((t) => t.side === p.side), theirs = g.teams.find((t) => t.side !== p.side);
  const margin = Number(mine?.score) + p.line - Number(theirs?.score);
  let note = "", tone = "";
  if (g.state === "in") [note, tone] = margin > 0 ? ["covering", "good"] : margin < 0 ? ["not covering", "bad"] : ["push", ""];
  else if (g.state === "post" && g.teams.some((t) => t.winner)) {
    // The graded result wins; until cfb-picks grades it, the final score decides.
    const r = p.result ?? (margin > 0 ? "W" : margin < 0 ? "L" : "P");
    [note, tone] = { W: ["won", "good"], L: ["lost", "bad"], P: ["push", ""] }[r] ?? ["", ""];
  }
  return { text: `Model: ${p.team} ${fmtLine(p.line)}${note ? ` · ${note}` : ""}`, tone };
}

function gameRow(g) {
  const status = g.state === "pre" ? (g.timeValid ? fmtTime(g.start) : "TBD") : g.detail;
  const team = (t) => `<span class="t${t.winner ? " w" : ""}${g.state === "post" && !t.winner && g.teams.some((x) => x.winner) ? " l" : ""}">${t.rank ? `<span class="rk">${t.rank}</span>` : ""}${esc(t.name)}</span>
    <span class="pts${t.winner ? " w" : ""}">${g.state === "pre" ? "" : esc(t.score)}</span>`;
  // Where to watch and the line before kickoff; just the network while it's on; nothing once it's over.
  const info = g.state === "pre" ? [g.tv, g.line].filter(Boolean) : g.state === "in" && g.tv ? [g.tv] : [];
  const pick = pickBadge(g);
  const inner = `${team(g.teams[0])}${team(g.teams[1])}<span class="st">${g.state === "in" ? `<span class="dot" aria-hidden="true"></span>` : ""}${esc(status)}</span>${info.length
    ? `<span class="info">${info.map(esc).join(" · ")}</span>` : ""}${pick ? `<span class="pick ${pick.tone}">${esc(pick.text)}</span>` : ""}`;
  const label = `${g.teams.map((t) => `${t.rank ? `#${t.rank} ` : ""}${t.name}${g.state === "pre" ? "" : ` ${t.score}`}`).join(" at ")}, ${status}${info.length ? `, ${info.join(", ")}` : ""}${pick ? `, ${pick.text.replace(" · ", ", ")}` : ""}`;
  return `<li class="game ${g.state}${g.uva ? " uva" : ""}">${safeUrl(g.link)
    ? `<a href="${esc(safeUrl(g.link))}" target="_blank" rel="noopener" aria-label="${esc(label)} (ESPN, new tab)">${inner}</a>`
    : `<div>${inner}</div>`}</li>`;
}

function renderLeague(lg) {
  const [yesterday, today] = dayWindow();
  const t = visible(boards[`${lg.key}:${today}`]), y = visible(boards[`${lg.key}:${yesterday}`]);
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
  // An empty tile (basketball before November, quiet days) hides, and the others widen (Rudy's choice).
  tileEl.hidden = !t.length && !y.length;
  arrangeRow();
  const opened = [...tileEl.querySelectorAll("details[open]")].map((d) => d.dataset.name);
  const live = [...t, ...y].filter((g) => g.state === "in").length;
  fill(`scores-${lg.key}`, {
    tag: live ? `${live} live` : t.length ? `${t.length} today` : "",
    hot: live > 0,
    body,
    when: `Top 25, UVA and ACC${lg.key === "cfb" && cfbPicks.size ? ", plus model picks" : ""}${live ? " · updates every minute" : ""}`,
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
      if (!boards[k] || visible(boards[k]).some((g) => g.state !== "post")) boards[k] = await loadBoard(lg, day);
    }));
    renderLeague(lg);
  } catch (e) {
    if (!days.some((d) => boards[`${lg.key}:${d}`])) return failTile(`scores-${lg.key}`, e, "Couldn't reach ESPN for scores.");
    console.warn(`[daily] ${lg.key} refresh failed; showing the last scores:`, e);
  }
  const games = days.flatMap((d) => visible(boards[`${lg.key}:${d}`]));
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
// Each index pairs with its front-month future, shown while the market is closed. There's no Composite
// future, so Nasdaq's is the Nasdaq 100's (the footer says so).
const INDEXES = [[".SPX", "S&P 500", "@SP.1"], [".IXIC", "Nasdaq", "@ND.1"]]; // Nasdaq = the Composite, as in the news
// Yields move in basis points; CNBC's change_pct for them is unreliable (it read −0.09% on a +5 bp day).
const RATES = [["US2Y", "2-yr", "bp"], ["US10Y", "10-yr", "bp"], [".VIX", "VIX", "pct"]];
const QUOTES_URL = `https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?${new URLSearchParams({
  symbols: [...INDEXES.flatMap(([ix, , fut]) => [ix, fut]), ...RATES.map(([s]) => s)].join("|"),
  requestMethod: "itv", noform: "1", partnerId: "2", fund: "1", exthrs: "1", output: "json", events: "1",
})}`;
const CLOSED_MS = 10 * 60 * 1000;
// Futures settle at 4 PM, pause 5–6 PM and reopen at 6 PM (Sunday 6 PM after a weekend). CNBC's change is
// measured from previous_day_closing, which only becomes the newest settle (settlePrice) once the evening
// session opens. Before that the change is just the day's move again, so the line waits for them to match.
// last_time can't be used: CNBC stamps futures with the next trade date (Saturday 6:01 PM, read on Saturday at midnight).
function overnightFutures(f, session) {
  const num = (s) => Number(String(s ?? "").replace(/,/g, ""));
  return Boolean(f?.change_pct && f.settleDate >= session && num(f.settlePrice) > 0 && num(f.previous_day_closing) === num(f.settlePrice));
}

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
const minus = (s) => String(s).replace(/^-/, "−");
const dirOf = (q) => q.changetype === "UP" ? "up" : q.changetype === "DOWN" ? "down" : "flat";
const ARROW = { up: "▲", down: "▼", flat: "" };

// "4.999%" with "+0.046" → "+4.6 bp"; the VIX keeps CNBC's percent change.
function rateCell(q, name, unit) {
  const chg = unit === "bp"
    ? (() => { const bp = Number(q.change) * 100; return `${bp < 0 ? "−" : bp > 0 ? "+" : ""}${Math.abs(bp).toFixed(1)} bp`; })()
    : minus(q.change_pct);
  return `<li><span class="r-name">${esc(name)}</span><span class="r-val">${esc(q.last)}</span><span class="r-chg">${esc(chg)}</span></li>`;
}

let quotesShown = false;
async function refreshMarkets() {
  clearTimeout(timers.markets);
  const hours = inMarketHours();
  try {
    const res = await fetch(QUOTES_URL);
    if (!res.ok) throw new Error(`quotes: HTTP ${res.status}`);
    const quotes = (await res.json()).FormattedQuoteResult.FormattedQuote;
    const bySymbol = Object.fromEntries(quotes.map((q) => [q.symbol, q]));
    const rows = INDEXES.map(([symbol, name, fut]) => ({ name, q: bySymbol[symbol], fut: bySymbol[fut] }));
    if (rows.some((r) => !r.q?.change_pct)) throw new Error("quotes: an index is missing");
    const asOf = rows[0].q.last_time;
    // After the close CNBC sends just the date ("2026-10-23"), which Date reads as UTC midnight, the evening
    // before in Eastern time, so a bare date is used as it is.
    const session = /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? asOf : etDate(new Date(asOf));
    const open = hours && session === todayET();
    const futuresOn = (f) => !open && overnightFutures(f, session);
    const cells = rows.map(({ name, q, fut }) => {
      const dir = dirOf(q);
      const futDir = futuresOn(fut) ? dirOf(fut) : null;
      return `<div class="index ${dir}">
        <p class="ix-name">${esc(name)}</p>
        <p class="ix-pct"><span aria-hidden="true">${ARROW[dir]}</span> ${esc(q.change_pct.replace(/^[+-]/, ""))}<span class="visually-hidden"> ${dir}</span></p>
        <p class="ix-sub">${esc(signed2(q.change))} · ${esc(num2(q.last))}</p>
        ${futDir ? `<p class="ix-fut ${futDir}">Futures <span aria-hidden="true">${ARROW[futDir]}</span> ${esc(fut.change_pct.replace(/^[+-]/, ""))}<span class="visually-hidden"> ${futDir}</span></p>` : ""}
      </div>`;
    }).join("");
    // Rates are extras: a missing one is left out rather than failing the tile.
    const rates = RATES.filter(([s]) => bySymbol[s]?.last).map(([s, name, unit]) => rateCell(bySymbol[s], name, unit)).join("");
    const closeLabel = session === todayET() ? "Today's close" : `${dayOf(session).toLocaleDateString(undefined, { weekday: "long" })}'s close`;
    const futNote = rows.some((r) => futuresOn(r.fut)) ? `<span>Nasdaq&nbsp;futures: Nasdaq&nbsp;100</span>` : "";
    fill("markets", {
      tag: open ? "Live" : "Closed",
      hot: open,
      body: `<div class="indexes">${cells}</div>${rates ? `<ul class="rates" aria-label="Treasury yields and the VIX">${rates}</ul>` : ""}`,
      when: open ? `As of ${esc(fmtTime(asOf))} · updates every minute` : `<span>${closeLabel}</span>${futNote}`,
    });
    quotesShown = true;
  } catch (e) {
    if (!quotesShown) failTile("markets", e, "Couldn't load market quotes.");
    else console.warn("[daily] markets refresh failed; showing the last quotes:", e);
  }
  timers.markets = setTimeout(() => whenVisible(refreshMarkets), hours ? LIVE_MS : CLOSED_MS);
}

// ---- Weather ----

// Open-Meteo needs no key and allows browser requests. Times come back as Eastern clock times ("2026-10-24T16:00").
const WX_PLACE = { name: "Virginia Beach", lat: 36.85, lon: -75.98 };
const WX_URL = `https://api.open-meteo.com/v1/forecast?${new URLSearchParams({
  latitude: WX_PLACE.lat, longitude: WX_PLACE.lon, current: "temperature_2m,weather_code", hourly: "precipitation_probability",
  daily: "temperature_2m_max,temperature_2m_min,sunset", temperature_unit: "fahrenheit", timezone: "America/New_York", forecast_days: "1",
})}`;
const WX_MS = 30 * 60 * 1000;
const RAIN_SHOWN = 20; // below this, "Rain unlikely"
// WMO weather codes, grouped into plain words.
const WX_WORDS = [
  [[0], "Clear"], [[1], "Mostly clear"], [[2], "Partly cloudy"], [[3], "Cloudy"], [[45, 48], "Fog"],
  [[51, 53, 55], "Drizzle"], [[56, 57, 66, 67], "Freezing rain"], [[61], "Light rain"], [[63], "Rain"], [[65], "Heavy rain"],
  [[71, 77], "Light snow"], [[73], "Snow"], [[75], "Heavy snow"], [[80, 81], "Showers"], [[82], "Heavy showers"],
  [[85, 86], "Snow showers"], [[95], "Thunderstorms"], [[96, 99], "Thunderstorms with hail"],
];
const wxWords = (code) => WX_WORDS.find(([codes]) => codes.includes(code))?.[1] ?? "";
// "2026-10-24T16:00" → "4 PM", "…T18:15" → "6:15 PM" (already Eastern, so no Date conversion).
const clock = (t) => { const h = Number(t.slice(11, 13)), m = t.slice(14, 16); return `${h % 12 || 12}${m === "00" ? "" : `:${m}`} ${h < 12 ? "AM" : "PM"}`; };

let wxShown = false;
async function refreshWeather() {
  clearTimeout(timers.weather);
  try {
    const res = await fetch(WX_URL);
    if (!res.ok) throw new Error(`weather: HTTP ${res.status}`);
    const d = await res.json();
    const now = d.current.time.slice(0, 13);
    // The rest of today's hours: the peak chance and the hour it comes.
    const left = d.hourly.time.map((t, i) => [t, d.hourly.precipitation_probability[i]]).filter(([t, p]) => t.slice(0, 13) >= now && p != null);
    const [peakAt, peak] = left.reduce((a, b) => (b[1] > a[1] ? b : a), ["", -1]);
    const rain = peak >= RAIN_SHOWN ? `Rain ${peak}% around ${clock(peakAt)}` : "Rain unlikely";
    const deg = (x) => `${Math.round(x)}°`;
    fill("weather", {
      body: `<p class="wx-now"><span class="wx-temp">${deg(d.current.temperature_2m)}</span> <span class="wx-cond">${esc(wxWords(d.current.weather_code))}</span></p>
        <p class="sub">H ${deg(d.daily.temperature_2m_max[0])} · L ${deg(d.daily.temperature_2m_min[0])} · ${esc(rain)} · Sunset ${esc(clock(d.daily.sunset[0]))}</p>`,
      when: `${esc(WX_PLACE.name)} · as of ${esc(clock(d.current.time))}`,
    });
    wxShown = true;
  } catch (e) {
    if (!wxShown) failTile("weather", e, "Couldn't load the weather.");
    else console.warn("[daily] weather refresh failed; showing the last forecast:", e);
  }
  timers.weather = setTimeout(() => whenVisible(refreshWeather), WX_MS);
}

// ---- Countdowns ----

// UVA's next football and men's basketball games (ESPN's team schedule: regular season and postseason), plus
// the dated reminders in data/countdowns.json, which Rudy edits by hand.
const COUNTDOWN_SPORTS = [["Football", "football/college-football"], ["Basketball", "basketball/mens-college-basketball"]];
const COUNTDOWNS_SHOWN = 3; // the row sits above the scores, so it stays short
const daysUntil = (key) => Math.round((dayOf(key) - dayOf(todayET())) / 864e5);
const untilText = (n) => n === 0 ? "Today" : n === 1 ? "Tomorrow" : `In ${n} days`;

async function nextUva([sport, path]) {
  const lists = await Promise.all([2, 3].map(async (type) => {
    const res = await fetch(`${ESPN}/${path}/teams/${UVA}/schedule?seasontype=${type}`);
    if (!res.ok) throw new Error(`countdowns ${sport}: HTTP ${res.status}`);
    return (await res.json()).events ?? [];
  }));
  const ev = lists.flat().filter((e) => e.competitions?.[0]?.status?.type?.state === "pre").sort((a, b) => a.date.localeCompare(b.date))[0];
  if (!ev) return null;
  const comp = ev.competitions[0];
  const me = comp.competitors.find((c) => c.id === UVA), opp = comp.competitors.find((c) => c.id !== UVA);
  const where = comp.neutralSite || me?.homeAway === "home" ? "vs" : "at";
  // A kickoff ESPN hasn't set yet comes as midnight Eastern with timeValid false.
  const when = comp.timeValid === false ? `${fmtDay(etDate(new Date(ev.date)))} · time TBA` : fmtKick(ev.date);
  const tv = comp.broadcasts?.[0]?.media?.shortName;
  return {
    date: etDate(new Date(ev.date)),
    what: `UVA ${where} ${opp?.team?.shortDisplayName ?? opp?.team?.displayName ?? "TBA"}`,
    meta: [sport, when, tv].filter(Boolean).join(" · "),
    link: ev.links?.[0]?.href ?? null,
  };
}

async function renderCountdowns() {
  const [games, mine] = await Promise.all([
    Promise.allSettled(COUNTDOWN_SPORTS.map(nextUva)),
    ownJson("data/countdowns.json").then((d) => d.items ?? []).catch((e) => { console.warn("[daily] countdowns.json:", e); return []; }),
  ]);
  for (const g of games) if (g.status === "rejected") console.warn("[daily] UVA schedule:", g.reason);
  const items = [
    ...games.map((g) => g.value).filter(Boolean),
    ...mine.map((x) => ({ date: x.date, what: x.label, meta: x.note ?? "" })),
  ].filter((x) => daysUntil(x.date) >= 0).sort((a, b) => a.date.localeCompare(b.date)).slice(0, COUNTDOWNS_SHOWN);
  if (!items.length && games.every((g) => g.status === "rejected")) return failTile("countdowns", games[0].reason, "Couldn't load what's coming up.");
  const row = (x) => {
    const inner = `<span class="cd-when">${untilText(daysUntil(x.date))}</span><span class="cd-what">${esc(x.what)}</span>${x.meta ? `<span class="meta">${esc(x.meta)}</span>` : ""}`;
    return `<li>${safeUrl(x.link) ? `<a href="${esc(safeUrl(x.link))}" target="_blank" rel="noopener">${inner}</a>` : inner}</li>`;
  };
  fill("countdowns", {
    body: items.length ? `<ol class="countdowns">${items.map(row).join("")}</ol>` : `<p class="label">Nothing coming up.</p>`,
  });
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
          <a href="${esc(safeUrl(u.link) ?? "#")}" target="_blank" rel="noopener"><b>${who(u.winner)}</b> <span class="line">+${u.line}</span> beat ${who(u.loser)}, ${u.winner.score}–${u.loser.score}</a>
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

// ---- AP Top 25 ----

// Each sport's poll shows in its own window (month and day, wrapping the new year): football from August
// through the title game, basketball from the preseason poll through the Final Four. Both in Oct–Jan, as tabs.
const POLLS = [
  { key: "cfb", name: "Football", path: "football/college-football", from: "08-15", to: "01-20", espn: "college-football" },
  { key: "cbb", name: "Basketball", path: "basketball/mens-college-basketball", from: "10-01", to: "04-15", espn: "mens-college-basketball" },
];
const POLL_SHOWN = 10;
const POLL_TAB_KEY = "hub:daily:top25Tab";
const inWindow = ({ from, to }, md = todayET().slice(5)) => from <= to ? md >= from && md <= to : md >= from || md <= to;

function pollRow(r, preseason) {
  const moved = r.previous ? r.previous - r.current : null;
  // Preseason polls have no previous week, so movement would say New for everyone.
  const [mv, said, dir] = preseason ? ["", "", ""]
    : moved == null ? ["New", "new this week", "new"]
    : moved > 0 ? [`▲${moved}`, `up ${moved}`, "up"]
    : moved < 0 ? [`▼${-moved}`, `down ${-moved}`, "down"] : ["–", "same as last week", ""];
  const name = r.team.nickname ?? r.team.location ?? r.team.name;
  return `<li class="${r.team.id === UVA ? "uva" : ""}"><span class="pr">${r.current}</span>
    <span class="pt">${esc(name)}${r.recordSummary && r.recordSummary !== "0-0" ?` <span class="rec">${esc(r.recordSummary.replace("-", "–"))}</span>` : ""}</span>
    <span class="mv ${dir}"><span aria-hidden="true">${mv}</span>${said ? `<span class="visually-hidden">${said}</span>` : ""}</span></li>`;
}

async function renderTop25() {
  const el = document.getElementById("top25");
  const live = POLLS.filter((p) => inWindow(p));
  if (!live.length) return; // summer: the tile stays hidden
  try {
    const polls = (await Promise.all(live.map(async (p) => {
      const res = await fetch(`${ESPN}/${p.path}/rankings`);
      if (!res.ok) throw new Error(`top25 ${p.key}: HTTP ${res.status}`);
      const ap = (await res.json()).rankings?.find((r) => r.type === "ap");
      return ap?.ranks?.length ? { ...p, ap } : null;
    }))).filter(Boolean);
    if (!polls.length) throw new Error("top25: no AP poll");
    el.hidden = false;
    arrangeRow();
    const many = polls.length > 1;
    const tabs = many ? `<div class="poll-tabs" role="tablist" aria-label="Sport">${polls.map((p) =>
      `<button type="button" role="tab" id="poll-tab-${p.key}" aria-controls="poll-${p.key}" data-key="${p.key}">${p.name}</button>`).join("")}</div>` : "";
    const panels = polls.map((p) => {
      const preseason = /preseason/i.test(p.ap.occurrence?.displayValue ?? "");
      const ranks = [...p.ap.ranks].sort((a, b) => a.current - b.current);
      return `<section id="poll-${p.key}" class="poll-panel"${many ? ` role="tabpanel" aria-labelledby="poll-tab-${p.key}"` : ""}>
        ${many ? "" : `<h3 class="visually-hidden">${p.name}</h3>`}
        <ol class="poll">${ranks.slice(0, POLL_SHOWN).map((r) => pollRow(r, preseason)).join("")}</ol>
        <details class="more" data-name="poll-${p.key}"><summary>Show ${POLL_SHOWN + 1}–${ranks.length}</summary>
          <ol class="poll" start="${POLL_SHOWN + 1}">${ranks.slice(POLL_SHOWN).map((r) => pollRow(r, preseason)).join("")}</ol></details>
      </section>`;
    }).join("");
    // The tag, footer and ESPN link follow the sport on show.
    const show = (key) => {
      const p = polls.find((x) => x.key === key) ?? polls[0];
      const uva = p.ap.ranks.find((r) => r.team.id === UVA);
      fill("top25", {
        tag: uva ? `UVA #${uva.current}` : "",
        when: `AP poll · ${esc(p.ap.occurrence?.displayValue ?? "")}${p.ap.date ? ` · ${esc(fmtShortDay(etDate(new Date(p.ap.date))))}` : ""}`,
      });
      const link = el.querySelector(".tile-foot a");
      link.href = `https://www.espn.com/${p.espn}/rankings`;
      link.setAttribute("aria-label", `Open ESPN's ${p.name.toLowerCase()} rankings in a new tab`);
    };
    fill("top25", { body: `${tabs}${panels}` });
    // The sport picked last is remembered; a first visit starts on football while its poll is out.
    let tab = savedTab(POLL_TAB_KEY);
    if (!polls.some((p) => p.key === tab)) tab = polls[0].key;
    if (many) makeTabs("top25", POLL_TAB_KEY, show)(tab);
    else show(tab);
  } catch (e) {
    el.hidden = false;
    arrangeRow();
    failTile("top25", e, "Couldn't load the AP Top 25.");
  }
}

// ---- Health ----

// The scheduled jobs that keep the apps' data fresh, checked live from GitHub so the tile still works when the
// hub's own job is broken. lateHours = the longest gap in the job's cron schedule (UTC) plus slack, because
// GitHub starts scheduled runs hours late and skips some. months = the months its cron runs in.
const JOBS = [
  // Every 3 h Thu–Mon and Tue 10:00: Tue 10:00 → Thu 00:00 is 38 h.
  { app: "NFL Tight End TDs", repo: "te-tracker", file: "update-data.yml", name: "Update data", months: [9, 10, 11, 12, 1, 2], lateHours: 50 },
  // Thu 15:00 and Sun 08:00: Sun → Thu is 103 h.
  { app: "NFL Tight End TDs", repo: "te-tracker", file: "snapshot-odds.yml", name: "Snapshot odds", months: [9, 10, 11, 12, 1, 2], lateHours: 115 },
  // Saturday into Sunday every 3 h, then Mon and Wed mornings: Wed → Sat is 78 h.
  { app: "College Football Picks", repo: "cfb-picks", file: "update-data.yml", name: "Update data", months: [8, 9, 10, 11, 12], lateHours: 90 },
  // Mon 01:00, Tue and Fri 14:00, Sat 13:00: Tue → Fri is 72 h.
  { app: "College Football Picks", repo: "cfb-picks", file: "snapshot-odds.yml", name: "Snapshot odds", months: [8, 9, 10, 11, 12], lateHours: 84 },
  // Every 2 h.
  { app: "King of the Court", repo: "kotc-tracker", file: "update-data.yml", name: "Update data", months: [10, 11, 12, 1, 2, 3, 4], lateHours: 10 },
  // 08:15, 14:15, 17:15 and 21:15: overnight is 11 h.
  { app: "NBA First Minute", repo: "nba-first-minute", file: "update-data.yml", name: "Update data", months: [10, 11, 12, 1, 2, 3, 4], lateHours: 24 },
  // Daily at 09:00.
  { app: "UVA Records", repo: "uva-records", file: "refresh.yml", name: "Refresh data", months: null, lateHours: 36 },
  // Hourly 10:20–04:20 (the cron Worker plus GitHub's schedule): overnight is 6 h.
  { app: "Hub Daily", repo: "hub", file: "update-daily.yml", name: "Update daily data", months: null, lateHours: 9 },
];
const HEALTH_KEY = "hub:daily:health:v1";
// 8 calls per check against GitHub's 60 an hour per network, which the hub page's commit ticker shares.
const HEALTH_MS = 20 * 60 * 1000;
const BAD_CONCLUSIONS = ["failure", "timed_out", "startup_failure"];
const JOB_WORDS = { failed: "Failed", late: "Late", running: "Running", ok: "OK", off: "Off season", starting: "Season starting" };

// When the job's current run of cron months began (UTC), so a job isn't late before its first run of the season.
function seasonStart(months, now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  for (let i = 0; i < 12 && months.includes(((d.getUTCMonth() + 11) % 12) + 1); i++) d.setUTCMonth(d.getUTCMonth() - 1);
  return d;
}

function jobStatus(job, runs, now = Date.now()) {
  const newest = runs[0];
  // Cancelled and skipped runs say nothing about whether the job works.
  const done = runs.find((r) => r.status === "completed" && !["cancelled", "skipped"].includes(r.conclusion));
  const inSeason = !job.months || job.months.includes(new Date(now).getUTCMonth() + 1);
  if (!inSeason) return "off";
  if (done && BAD_CONCLUSIONS.includes(done.conclusion)) return "failed";
  if (newest && newest.status !== "completed") return "running";
  const lateMs = job.lateHours * 3600e3;
  if (!newest || now - new Date(newest.created_at) > lateMs) {
    if (job.months && now - seasonStart(job.months) < lateMs) return "starting";
    return "late";
  }
  return "ok";
}

async function fetchRuns() {
  const out = {};
  await Promise.all(JOBS.map(async (job) => {
    const res = await fetch(`https://api.github.com/repos/mattrudy13/${job.repo}/actions/workflows/${job.file}/runs?per_page=5&exclude_pull_requests=true`);
    if (res.status === 403 || res.status === 429) throw Object.assign(new Error(`health: GitHub rate limit (${res.status})`), { rateLimited: true });
    if (!res.ok) throw new Error(`health ${job.repo}/${job.file}: HTTP ${res.status}`);
    out[`${job.repo}/${job.file}`] = ((await res.json()).workflow_runs ?? []).map((r) => ({
      status: r.status, conclusion: r.conclusion, created_at: r.created_at, html_url: r.html_url, event: r.event,
    }));
  }));
  return out;
}

async function refreshHealth() {
  clearTimeout(timers.health);
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem(HEALTH_KEY)); } catch {}
  let check = cached && Date.now() - cached.at < HEALTH_MS ? cached : null, note = "";
  if (!check) {
    try {
      check = { at: Date.now(), runs: await fetchRuns() };
      try { localStorage.setItem(HEALTH_KEY, JSON.stringify(check)); } catch {}
    } catch (e) {
      console.warn("[daily] health check failed:", e);
      if (!cached) {
        failTile("health", e, e.rateLimited ? "GitHub's hourly limit for this network is used up; try again later." : "Couldn't reach GitHub to check the jobs.");
        timers.health = setTimeout(() => whenVisible(refreshHealth), HEALTH_MS);
        return;
      }
      check = cached;
      note = e.rateLimited ? "GitHub's hourly limit is used up; showing the last check." : "Couldn't reach GitHub; showing the last check.";
    }
  }
  renderHealth(check, note);
  timers.health = setTimeout(() => whenVisible(refreshHealth), HEALTH_MS);
}

function renderHealth(check, note = "") {
  const el = document.getElementById("health");
  const jobs = JOBS.map((job) => {
    const runs = check.runs[`${job.repo}/${job.file}`] ?? [];
    return { ...job, runs, status: jobStatus(job, runs, check.at) };
  });
  const broken = jobs.filter((j) => j.status === "failed" || j.status === "late");
  const order = { failed: 0, late: 1, running: 2, ok: 3, starting: 4, off: 5 };
  const row = (j) => {
    const run = j.status === "failed" ? j.runs.find((r) => BAD_CONCLUSIONS.includes(r.conclusion)) : j.runs[0];
    // The hub's job is started by the cron Worker (workflow_dispatch) or, as a fallback, GitHub's own schedule.
    const by = j.repo === "hub" && run ? (run.event === "workflow_dispatch" ? " · started by the Worker" : run.event === "schedule" ? " · started by GitHub's schedule" : "") : "";
    const when = run ? `last run ${ago(run.created_at)}${by}` : "no runs yet";
    const inner = `<span class="jdot" aria-hidden="true"></span><span class="jn">${esc(j.app)} · ${esc(j.name)}</span>
      <span class="js"><b>${JOB_WORDS[j.status]}</b> · ${esc(when)}</span>`;
    return `<li class="job is-${j.status}">${safeUrl(run?.html_url) ? `<a href="${esc(safeUrl(run.html_url))}" target="_blank" rel="noopener">${inner}</a>` : inner}</li>`;
  };
  const list = `<ul class="jobs">${[...jobs].sort((a, b) => order[a.status] - order[b.status]).map(row).join("")}</ul>`;
  const failed = broken.filter((j) => j.status === "failed").length, late = broken.length - failed;
  const summary = broken.length
    ? [failed && `${failed} failed`, late && `${late} late`].filter(Boolean).join(" · ")
    : `All ${jobs.filter((j) => j.status !== "off").length} jobs in season are OK`;
  fill("health", {
    tag: broken.length ? summary : "All OK",
    body: broken.length
      ? list
      :`<details class="older" data-name="jobs"><summary class="day">${esc(summary)}</summary>${list}</details>`,
    when: `Checked ${esc(ago(new Date(check.at).toISOString()))}${note ? ` · ${esc(note)}` : ""}`,
  });
  el.classList.toggle("bad", broken.length > 0);
  // Something broken moves up under Markets (a DOM move, so screen readers meet it there too); else it sits last.
  const main = el.parentElement;
  if (broken.length) document.getElementById("markets").after(el);
  else main.append(el);
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
  arrangeRow();
  refreshMarkets();
  refreshWeather();
  renderCountdowns();
  renderNews();
  renderUpsets();
  renderTop25();
  renderYoutube();
  refreshHealth();
  LEAGUES.forEach(refreshLeague);
  // Picks only add badges, so football doesn't wait for them: once they're in, redraw it if it has drawn.
  loadPicks().then(() => {
    const cfb = LEAGUES.find((lg) => lg.key === "cfb");
    if (cfbPicks.size && dayWindow().some((d) => boards[`cfb:${d}`])) renderLeague(cfb);
  });
}
