// Money and housing numbers for the Home Base page. Writes data/housing.json. Node 22, no packages, no keys.
//   - Mortgage rates: Freddie Mac's weekly survey (PMMS), 30- and 15-year fixed.
//   - Gas: EIA's weekly regular gas price for the Lower Atlantic region (PADD 1C, which includes Virginia;
//     EIA doesn't publish Virginia on its own). Read from EIA's public table page, since its API needs a key.
//   - Rent and home values: Zillow's monthly city files for Virginia Beach (ZORI rent index, ZHVI home value).
// All of these move weekly or monthly, so the hourly job refreshes this file at most every 20 hours.
// Usage: node scripts/housing.mjs [--force]

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const OUT = "data/housing.json";
const CITY = { name: "Virginia Beach", state: "VA" };
const MIN_HOURS = 20;
const UA = { "User-Agent": "Mozilla/5.0 (hub Home Base page; github.com/mattrudy13/hub)" };

let previous = null;
try { previous = JSON.parse(readFileSync(OUT, "utf8")); } catch {}
if (!process.argv.includes("--force") && previous && Date.now() - new Date(previous.updated) < MIN_HOURS * 3600000) {
  console.log(`housing.json is under ${MIN_HOURS} h old, so it's skipped`);
  process.exit(0);
}

async function text(url) {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`${new URL(url).hostname}: HTTP ${res.status}`);
  return res.text();
}

// Freddie Mac: date,pmms30,pmms30p,pmms15,pmms15p (older rows have blanks for the 15-year).
async function mortgage() {
  const rows = (await text("https://www.freddiemac.com/pmms/docs/PMMS_history.csv")).trim().split(/\r?\n/);
  const head = rows[0].split(",");
  const col = (n) => head.indexOf(n);
  const data = rows.slice(1).map((r) => r.split(",")).map((r) => {
    const [m, d, y] = r[col("date")].split("/");
    return { date: `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`, rate30: Number(r[col("pmms30")]), rate15: Number(r[col("pmms15")]) || null };
  }).filter((r) => r.rate30).sort((a, b) => a.date.localeCompare(b.date));
  return data.slice(-53); // a year of weeks, plus one for the year-ago comparison
}

// EIA's weekly table: a header row of week-ending dates (MM/DD/YY), then a "Regular" row of prices.
async function gas() {
  const h = await text("https://www.eia.gov/dnav/pet/pet_pri_gnd_dcus_r1z_w.htm");
  const dates = [...h.matchAll(/<th[^>]*class="Series5"[^>]*>\s*(\d{2})\/(\d{2})\/(\d{2})\s*<\/th>/g)].map((m) => `20${m[3]}-${m[1]}-${m[2]}`);
  // Only the Regular row (it ends at its history link); the newest week's cell is styled "Current2", not "DataB".
  const start = h.indexOf(">Regular<");
  const row = h.slice(start, h.indexOf("DataHist", start));
  const prices = [...row.matchAll(/<td[^>]*class="(?:DataB|Current\d?)"[^>]*>\s*([\d.]+)\s*<\/td>/g)].map((m) => Number(m[1]));
  if (!dates.length || prices.length !== dates.length) throw new Error(`EIA gas table changed (${dates.length} dates, ${prices.length} prices)`);
  return dates.map((date, i) => ({ date, price: prices[i] }));
}

// Zillow's city CSVs are sorted by size, so Virginia Beach is near the top: stream until its row, then stop
// (the home value file is ~94 MB).
async function zillowCity(url) {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error(`zillow: HTTP ${res.status}`);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "", head = null;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        const cells = line.split(",").map((c) => c.replace(/^"|"$/g, ""));
        if (!head) { head = cells; continue; }
        if (cells[head.indexOf("RegionName")] === CITY.name && cells[head.indexOf("State")] === CITY.state) {
          const first = head.findIndex((c) => /^\d{4}-\d{2}-\d{2}$/.test(c));
          // The last 25 months: this month and the same month a year earlier, plus the line in between.
          return head.slice(first).map((date, i) => ({ month: date.slice(0, 7), value: Number(cells[first + i]) || null }))
            .filter((x) => x.value).slice(-25);
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  throw new Error(`zillow: no ${CITY.name}, ${CITY.state} row`);
}

const ZILLOW = "https://files.zillowstatic.com/research/public_csvs";
const jobs = {
  mortgage,
  gas,
  rent: () => zillowCity(`${ZILLOW}/zori/City_zori_uc_sfrcondomfr_sm_month.csv`),
  homeValue: () => zillowCity(`${ZILLOW}/zhvi/City_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv`),
};

const out = { updated: new Date().toISOString(), city: CITY, failed: [] };
for (const [key, job] of Object.entries(jobs)) {
  try {
    out[key] = await job();
    const last = out[key].at(-1);
    console.log(`${key}: ${out[key].length} points, latest ${JSON.stringify(last)}`);
  } catch (e) {
    console.warn(`${key}: ${e.message}`);
    out.failed.push(key);
    // Keep the last good numbers so the tile doesn't go blank.
    if (previous?.[key]) out[key] = previous[key];
  }
}

mkdirSync("data", { recursive: true });
writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
if (out.failed.length === Object.keys(jobs).length) {
  console.error("Every housing source failed");
  process.exit(1);
}
