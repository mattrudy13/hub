// Concerts, sports, shows and family events around Hampton Roads for the next 2 weeks, from Ticketmaster's
// Discovery API (key in the TICKETMASTER_KEY secret; free tier is 5,000 calls a day, this uses 1–3 a run).
// Writes data/events.json for the Home Base page. Node 22, no packages.
// Usage: TICKETMASTER_KEY=… node scripts/events.mjs

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const OUT = "data/events.json";
// Between Norfolk and Virginia Beach; 25 miles reaches the Oceanfront, Portsmouth, Chesapeake and Hampton
// (all of Hampton Roads, Rudy's choice), so the Norfolk arenas and the Portsmouth amphitheater count.
const CENTER = "36.86,-76.15";
const RADIUS_MILES = 25;
const DAYS = 14;
const KEY = process.env.TICKETMASTER_KEY;
if (!KEY) {
  console.log("TICKETMASTER_KEY isn't set, so events are skipped");
  process.exit(0);
}

// Ticketmaster lists parking passes, upgrades and add-ons as their own events.
const NOT_AN_EVENT = /\b(parking|lot pass|upgrade|vip package|vip experience|souvenir|merch|add-on|suite)\b/i;

const iso = (d) => d.toISOString().replace(/\.\d{3}Z$/, "Z");
const from = new Date();
const to = new Date(from.getTime() + DAYS * 86400000);

async function page(n) {
  const params = new URLSearchParams({
    apikey: KEY, latlong: CENTER, radius: RADIUS_MILES, unit: "miles", locale: "*",
    startDateTime: iso(from), endDateTime: iso(to), size: 200, page: n, sort: "date,asc",
  });
  const res = await fetch(`https://app.ticketmaster.com/discovery/v2/events.json?${params}`, { signal: AbortSignal.timeout(20000) });
  // The error names the status only, never the URL, so the key can't end up in a log.
  if (!res.ok) throw new Error(`Ticketmaster: HTTP ${res.status}`);
  return res.json();
}

const raw = [];
for (let n = 0; n < 5; n++) {
  const body = await page(n);
  raw.push(...(body._embedded?.events ?? []));
  if (n + 1 >= (body.page?.totalPages ?? 0)) break;
}

// Ticketmaster's segments, folded into the page's filters. Comedy is a genre under Arts & Theatre.
function kindOf(c) {
  const seg = c?.segment?.name, genre = c?.genre?.name ?? "";
  if (/comedy/i.test(genre)) return "Comedy";
  if (seg === "Music") return "Music";
  if (seg === "Sports") return "Sports";
  if (seg === "Arts & Theatre") return /family|children/i.test(genre) || c?.family ? "Family" : "Arts";
  if (c?.family || /family/i.test(genre)) return "Family";
  return "Other";
}

const seen = new Set();
const events = [];
for (const e of raw) {
  if (NOT_AN_EVENT.test(e.name) || e.dates?.status?.code === "cancelled") continue;
  const v = e._embedded?.venues?.[0];
  const date = e.dates?.start?.localDate;
  if (!date) continue;
  // The same show is often listed once per ticket type.
  const key = `${e.name.toLowerCase()}|${v?.id}|${date}|${e.dates.start.localTime ?? ""}`;
  if (seen.has(key)) continue;
  seen.add(key);
  const c = e.classifications?.find((x) => x.primary) ?? e.classifications?.[0];
  const img = (e.images ?? []).filter((i) => i.ratio === "16_9" && i.width >= 300).sort((a, b) => a.width - b.width)[0];
  events.push({
    id: e.id,
    name: e.name,
    date,
    time: e.dates.start.timeTBA || e.dates.start.noSpecificTime ? null : e.dates.start.localTime?.slice(0, 5) ?? null,
    status: e.dates?.status?.code ?? null, // onsale, offsale, postponed, rescheduled
    kind: kindOf(c),
    genre: c?.genre?.name && !/undefined|other/i.test(c.genre.name) ? c.genre.name : null,
    venue: v?.name ?? null,
    city: v?.city?.name ?? null,
    url: e.url ?? null,
    priceMin: e.priceRanges?.[0]?.min ?? null,
    image: img?.url ?? null,
  });
}
events.sort((a, b) => (a.date + (a.time ?? "99")).localeCompare(b.date + (b.time ?? "99")));

let previous = null;
try { previous = JSON.parse(readFileSync(OUT, "utf8")); } catch {}
mkdirSync("data", { recursive: true });
writeFileSync(OUT, JSON.stringify({ updated: new Date().toISOString(), from: iso(from), to: iso(to), radiusMiles: RADIUS_MILES, events }, null, 2) + "\n");
console.log(`${events.length} events (${raw.length} listings) through ${to.toISOString().slice(0, 10)}; was ${previous?.events?.length ?? "none"}`);
