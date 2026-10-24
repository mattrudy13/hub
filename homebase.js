// The Home Base page: things to do around Hampton Roads, then money and housing numbers for Virginia Beach.
// Events and housing come from data/, which the "Update daily data" workflow writes (scripts/events.mjs,
// scripts/housing.mjs). The apartments tile reads the apartment tracker's own published files.

const MAX_EVENTS = 12;
const KIND_KEY = "hub:home:kind";
const KINDS = ["Music", "Sports", "Comedy", "Arts", "Family", "Other"];
const EVENTS_STALE_HOURS = 8;
const HOUSING_STALE_HOURS = 48; // refreshed once a day

async function ownJson(path) {
  const res = await fetch(path, { cache: "no-cache" });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

function fill(id, { tag = "", body, when = "" }) {
  const el = document.getElementById(id);
  el.querySelector(".tag").innerHTML = tag;
  if (body != null) el.querySelector(".tile-body").innerHTML = body;
  el.querySelector(".when").innerHTML = when;
  el.removeAttribute("aria-busy");
}

function failTile(id, e, message) {
  console.warn(`[home] ${id}:`, e);
  document.getElementById(id).classList.add("failed");
  fill(id, { body: `<p class="label">${message}</p>` });
}

const late = (iso, hours) => hoursSince(iso) > hours ? ` <span class="late">Running late</span>` : "";
const shiftDay = (key, n) => { const d = dayOf(key); d.setDate(d.getDate() + n); return new Intl.DateTimeFormat("en-CA").format(d); };
const monthName = (ym) => new Date(`${ym}-15T12:00:00`).toLocaleDateString(undefined, { month: "short", year: "numeric" });
const clock = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };

// "Up 0.05 from last week": words instead of arrows or red/green, since a rise isn't good or bad for every number here.
function moved(now, before, fmtDiff, since) {
  const d = now - before;
  if (Math.abs(d) < 1e-9) return `No change from ${since}`;
  return `${d > 0 ? "Up" : "Down"} ${fmtDiff(Math.abs(d))} from ${since}`;
}

// A small trend line: faint area, 2px line, the latest point marked. Values are in the text beside it,
// so it needs no axis or tooltip.
function sparkline(values, label) {
  const W = 240, H = 48, P = 4;
  const lo = Math.min(...values), hi = Math.max(...values), span = hi - lo || 1;
  const x = (i) => P + (i / Math.max(values.length - 1, 1)) * (W - 2 * P);
  const y = (v) => P + (1 - (v - lo) / span) * (H - 2 * P);
  const line = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const area = `${line}L${x(values.length - 1).toFixed(1)},${H}L${x(0).toFixed(1)},${H}Z`;
  const end = values.length - 1;
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(label)}">
    <path d="${area}" fill="var(--line)" opacity=".6"/>
    <path d="${line}" fill="none" stroke="var(--ink)" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
    <path d="M${x(end)},${y(values[end])}h0" stroke="var(--hot)" stroke-width="8" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>`;
  // (The end dot is a round-capped zero-length line: a <circle> would stretch with the chart's width.)
}

const figure = ({ big, unit = "", label, subs = [] }) => `<p class="big">${big}${unit ? `<small>${unit}</small>` : ""}</p>
  <p class="label">${label}</p>${subs.map((s) => `<p class="sub">${s}</p>`).join("")}`;

// ---- Things to do ----

// The coming Friday–Sunday (or the rest of it, when it's already the weekend).
function weekend() {
  const today = todayET();
  const dow = dayOf(today).getDay(); // 0 = Sunday
  const fri = dow === 0 ? shiftDay(today, -2) : dow === 6 ? shiftDay(today, -1) : shiftDay(today, 5 - dow);
  return { from: dow === 0 || dow === 6 ? today : fri, to: shiftDay(fri, 2) };
}

function dayHeading(key) {
  const today = todayET();
  if (key === today) return "Today";
  if (key === shiftDay(today, 1)) return "Tomorrow";
  return fmtDay(key);
}

let eventData = null;
let kind = "All";
try { kind = localStorage.getItem(KIND_KEY) || "All"; } catch {}

function eventRow(e) {
  const meta = [e.venue, e.city, e.genre ?? (e.kind === "Other" ? null : e.kind)].filter(Boolean).map(esc).join(" · ");
  const flag = { postponed: "Postponed", rescheduled: "Rescheduled", offsale: "Off sale" }[e.status];
  const name = e.url ? `<a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.name)}</a>` : esc(e.name);
  return `<li class="ev">
    <span class="ev-time">${e.time ? clock(e.time) : "Time TBA"}</span>
    <span class="ev-what">${name}${flag ? ` <span class="ev-flag">${flag}</span>` : ""}<span class="meta">${meta}</span></span>
    <span class="ev-price">${e.priceMin ? `From ${money(e.priceMin)}` : ""}</span></li>`;
}

function renderEventList() {
  const all = eventData.events.filter((e) => e.date >= todayET());
  const shown = kind === "All" ? all : all.filter((e) => e.kind === kind);
  const counts = Object.fromEntries(KINDS.map((k) => [k, all.filter((e) => e.kind === k).length]));
  const chips = ["All", ...KINDS.filter((k) => counts[k])].map((k) =>
    `<button type="button" class="chip-btn" data-kind="${k}" aria-pressed="${k === kind}">${k}<span>${k === "All" ? all.length : counts[k]}</span></button>`).join("");

  // Group by day; the first MAX_EVENTS show, the rest fold away like the score tiles' "Show N more".
  const group = (list) => {
    const days = [...new Set(list.map((e) => e.date))];
    const { from, to } = weekend();
    return days.map((d) => `<h3 class="day">${dayHeading(d)}${d >= from && d <= to ? ` <span class="wk">Weekend</span>` : ""}</h3>
      <ul class="evs">${list.filter((e) => e.date === d).map(eventRow).join("")}</ul>`).join("");
  };
  const first = shown.slice(0, MAX_EVENTS), rest = shown.slice(MAX_EVENTS);
  const body = `<div class="chips" role="group" aria-label="Kind of event">${chips}</div>
    ${shown.length ? group(first) : `<p class="sub">No ${kind === "All" ? "" : `${kind.toLowerCase()} `}events in the next 2 weeks.</p>`}
    ${rest.length ? `<details class="more"><summary>Show ${rest.length} more</summary>${group(rest)}</details>` : ""}`;
  const { from, to } = weekend();
  const wk = all.filter((e) => e.date >= from && e.date <= to).length;
  fill("events", { tag: wk ? `${wk} this weekend` : "", body, when: `Updated ${esc(ago(eventData.updated))}${late(eventData.updated, EVENTS_STALE_HOURS)}` });
}

async function renderEvents() {
  try {
    eventData = await ownJson("data/events.json");
  } catch (e) {
    // Until the Ticketmaster key is set there's no file yet.
    return fill("events", { body: `<p class="label">Events will appear here once the Ticketmaster key is set up.</p>` });
  }
  if (!KINDS.includes(kind)) kind = "All";
  renderEventList();
}

document.getElementById("events").addEventListener("click", (e) => {
  const b = e.target.closest(".chip-btn");
  if (!b) return;
  kind = b.dataset.kind;
  try { localStorage.setItem(KIND_KEY, kind); } catch {}
  renderEventList();
  document.querySelector(`#events .chip-btn[data-kind="${kind}"]`)?.focus();
});

// ---- Money & housing ----

// Viable units across the tracked complexes at the end of each week: each complex's latest count on or
// before that day (complexes aren't all scraped on the same days).
function viableByWeek(complexes) {
  const dates = [...new Set(complexes.flatMap((c) => (c.history ?? []).map((h) => h.date)))].sort();
  const monday = (d) => shiftDay(d, -((dayOf(d).getDay() + 6) % 7));
  const weekEnds = dates.filter((d, i) => i === dates.length - 1 || monday(dates[i + 1]) !== monday(d));
  return weekEnds.map((d) => ({
    date: d,
    units: complexes.reduce((s, c) => s + ((c.history ?? []).filter((h) => h.date <= d).at(-1)?.viable_units ?? 0), 0),
  }));
}

async function renderApartments() {
  try {
    const [viable, summary] = await Promise.all([getJson("apartments/data/viable.json"), getJson("apartments/data/summary.json")]);
    const units = viable.units ?? [];
    const crit = viable.criteria ?? {};
    const rule = `${(crit.beds ?? [1, 2]).map(Number).join("–")} BR under ${money(crit.max_monthly)}/mo`;
    const lastPull = summary.complexes.map((c) => c.date).filter(Boolean).sort().at(-1);
    const weeks = viableByWeek(summary.complexes);
    // Same number as the hub tile, the tracker and the email digest: the lowest `monthly`.
    const best = [...units].sort((a, b) => a.monthly - b.monthly)[0];
    const byBeds = [1, 2].map((b) => [b, units.filter((u) => Number(u.beds) === b).sort((x, y) => x.monthly - y.monthly)[0]]).filter(([, u]) => u);
    const left = best
      ? figure({ big: money(best.monthly), unit: "/mo", label: `Cheapest viable: ${esc(best.complex)} · ${best.beds} BR`,
        subs: [`${units.length} viable units at ${new Set(units.map((u) => u.slug)).size} of ${summary.complexes.length} complexes (${rule})`,
          byBeds.map(([b, u]) => `${b} BR from ${money(u.monthly)}`).join(" · ")] })
      : figure({ big: "0", label: `Viable units this week (${rule})` });
    const right = weeks.length > 1
      ? `<div class="trend"><p class="trend-label">Viable units by week</p>${sparkline(weeks.map((w) => w.units), `Viable units by week: ${weeks.map((w) => w.units).join(", ")}`)}
         <p class="sub">${weeks.slice(-5).map((w) => `<span class="wkpt">${fmtSlashDay(w.date)} <b>${w.units}</b></span>`).join("")}</p></div>` : "";
    fill("apts", { tag: "Weekly", body: `<div class="split-fig"><div>${left}</div>${right}</div>`,
      when: lastPull ? `Pulled ${fmtDay(lastPull)}${(Date.now() - dayOf(lastPull)) / 864e5 > 9 ? ` <span class="late">Running late</span>` : ""}` : "" });
  } catch (e) {
    failTile("apts", e, "Couldn't load the apartment tracker.");
  }
}

function renderHousing(h) {
  const when = (text) => `${text}${late(h.updated, HOUSING_STALE_HOURS)}`;
  const stale = (key) => h.failed?.includes(key) ? `<p class="sub">Couldn't refresh on the last check; showing the last numbers.</p>` : "";

  if (h.mortgage?.length) {
    const m = h.mortgage, last = m.at(-1), prev = m.at(-2), yearAgo = m.find((x) => x.date >= shiftDay(last.date, -365)) ?? m[0];
    fill("mortgage", { tag: "Weekly",
      body: figure({ big: last.rate30.toFixed(2), unit: "%", label: "30-year fixed, national average",
        subs: [moved(last.rate30, prev.rate30, (d) => `${d.toFixed(2)} pts`, "last week"),
          `${last.rate15 ? `15-year ${last.rate15.toFixed(2)}% · ` : ""}a year ago ${yearAgo.rate30.toFixed(2)}%`] })
        + sparkline(m.map((x) => x.rate30), `30-year rate over the last year, from ${m[0].rate30}% to ${last.rate30}%`) + stale("mortgage"),
      when: when(`Week of ${fmtShortDay(last.date)}`) });
  } else failTile("mortgage", "no data", "No mortgage data yet.");

  const zillow = (id, key, { fmt, label, what }) => {
    const s = h[key];
    if (!s?.length) return failTile(id, "no data", "No Zillow data yet.");
    const last = s.at(-1), yearAgo = s.find((x) => x.month === `${Number(last.month.slice(0, 4)) - 1}${last.month.slice(4)}`);
    const yoy = yearAgo ? (last.value / yearAgo.value - 1) * 100 : null;
    fill(id, { tag: "Monthly",
      body: figure({ big: fmt(last.value), unit: id === "rent" ? "/mo" : "", label,
        subs: [yoy == null ? "" : `${yoy >= 0 ? "Up" : "Down"} ${Math.abs(yoy).toFixed(1)}% from ${monthName(yearAgo.month)}`] })
        + sparkline(s.map((x) => x.value), `${what} over 2 years, from ${fmt(s[0].value)} to ${fmt(last.value)}`) + stale(key),
      when: when(`${monthName(last.month)}, the latest month`) });
  };
  zillow("rent", "rent", { fmt: (v) => money(v), label: "Typical asking rent, all home types (Zillow rent index)", what: "Typical rent" });
  zillow("homes", "homeValue", { fmt: (v) => money(Math.round(v / 100) * 100), label: "Typical home value, mid-priced homes (Zillow home value index)", what: "Typical home value" });

  if (h.gas?.length) {
    const g = h.gas, last = g.at(-1), prev = g.at(-2);
    fill("gas", { tag: "Weekly",
      body: figure({ big: `$${last.price.toFixed(2)}`, unit: "/gal", label: "Regular, Lower Atlantic states (Virginia isn't reported on its own)",
        subs: [prev ? moved(last.price, prev.price, (d) => `$${d.toFixed(2)}`, "last week") : ""] })
        + sparkline(g.map((x) => x.price), `Regular gas over ${g.length} weeks, from $${g[0].price} to $${last.price}`) + stale("gas"),
      when: when(`Week of ${fmtShortDay(last.date)}`) });
  } else failTile("gas", "no data", "No gas data yet.");
}

async function renderMoney() {
  try {
    renderHousing(await ownJson("data/housing.json"));
  } catch (e) {
    for (const id of ["mortgage", "rent", "homes", "gas"]) failTile(id, e, "Couldn't load the housing numbers.");
  }
}

function renderHome() {
  document.getElementById("subline").textContent = `Virginia Beach · ${new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}`;
  renderEvents();
  renderApartments();
  renderMoney();
}
