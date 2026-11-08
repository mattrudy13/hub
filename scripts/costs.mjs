// Paycheck share for the Home Base page: what part of a typical Virginia Beach paycheck (before taxes) a single
// renter with one car spends on rent, groceries, electricity, car insurance and gas. Writes data/costs.json.
// Node 22, no packages, no keys.
//
// Sources, and why each one:
//   - Pay: BLS QCEW average weekly wage, all industries, Virginia Beach–Norfolk–Newport News metro (C4726).
//     It's the only local pay series that's free and keyless. It's an average, not a median, and Q1 includes
//     bonuses, so each quarter uses the average of the last four quarters to smooth that out.
//   - Rent: Zillow's typical rent (ZORI) for the city of Virginia Beach. The only truly local monthly cost.
//   - Gas: EIA monthly regular gas, Lower Atlantic (PADD 1C; EIA doesn't publish Virginia alone), × 45 gallons.
//   - Groceries: USDA's moderate-cost food plan, one adult 19–50 (male and female averaged), +20% for a one-person
//     household as USDA suggests. Pinned to the September 2026 report and moved month to month with BLS's
//     South-region food-at-home index, since there's no index for this metro.
//   - Electricity: EIA's 2024 average Virginia residential bill (all homes, so it likely runs high for an
//     apartment), moved with BLS's South-region electricity index.
//   - Car insurance: NAIC's 2023 U.S. average spending per insured car. NAIC's state table wasn't reachable,
//     so this is a national figure, moved with BLS's U.S. motor vehicle insurance index.
// Everything moves monthly or slower, so the hourly job refreshes this file at most every 20 hours.
// Usage: node scripts/costs.mjs [--force]

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const OUT = "data/costs.json";
const MIN_HOURS = 20;
const START = "2021-01";
const UA = { "User-Agent": "Mozilla/5.0 (hub Home Base page; github.com/mattrudy13/hub)" };

// Fixed starting points. Each is a published figure, moved through time with a price index below.
const ANCHORS = {
  groceries: { value: ((336.4 + 398.4) / 2) * 1.2, month: "2026-09", source: "USDA moderate-cost food plan, Sep 2026" },
  electricity: { value: 148.77, year: 2024, source: "EIA average Virginia residential bill, 2024" },
  insurance: { value: 1281 / 12, year: 2023, source: "NAIC U.S. average per insured car, 2023" },
};
const GAS_GALLONS = 45;
const CPI = { groceries: "CUUR0300SAF11", electricity: "CUUR0300SEHF01", insurance: "CUUR0000SETE" };

let previous = null;
try { previous = JSON.parse(readFileSync(OUT, "utf8")); } catch {}
if (!process.argv.includes("--force") && previous && Date.now() - new Date(previous.updated) < MIN_HOURS * 3600000) {
  console.log(`costs.json is under ${MIN_HOURS} h old, so it's skipped`);
  process.exit(0);
}

async function get(url, init = {}) {
  const res = await fetch(url, { ...init, headers: { ...UA, ...init.headers }, signal: AbortSignal.timeout(60000) });
  return res;
}

const monthsFrom = (from, to) => {
  const out = [];
  let [y, m] = from.split("-").map(Number);
  for (;;) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    if (key > to) return out;
    out.push(key);
    if (++m > 12) { m = 1; y++; }
  }
};
const quarterOf = (month) => `${month.slice(0, 4)}-Q${Math.ceil(Number(month.slice(5)) / 3)}`;

// QCEW: one CSV per quarter (~230 KB). Quarters never change once published, so they're kept in costs.json and
// only quarters we don't have yet are fetched. The four quarters before 2021 are needed for the first average.
async function wages() {
  const have = { ...(previous?.wages || {}) };
  const now = new Date();
  for (let y = 2020; y <= now.getUTCFullYear(); y++) {
    for (let q = 1; q <= 4; q++) {
      const key = `${y}-Q${q}`;
      if (have[key] || new Date(Date.UTC(y, q * 3, 1)) > now) continue;
      const res = await get(`https://data.bls.gov/cew/data/api/${y}/${q}/area/C4726.csv`);
      if (res.status === 404) continue; // not published yet (QCEW runs ~5 months behind)
      if (!res.ok) throw new Error(`QCEW ${key}: HTTP ${res.status}`);
      const rows = (await res.text()).trim().split(/\r?\n/).map((r) => r.split(",").map((c) => c.replace(/^"|"$/g, "")));
      const head = rows[0];
      // own_code 0 + industry_code 10 = every employer, every industry.
      const total = rows.find((r) => r[head.indexOf("own_code")] === "0" && r[head.indexOf("industry_code")] === "10");
      const weekly = Number(total?.[head.indexOf("avg_wkly_wage")]);
      if (!weekly) throw new Error(`QCEW ${key}: no all-industry row`);
      have[key] = weekly;
    }
  }
  return Object.fromEntries(Object.entries(have).sort());
}

// BLS public API v1: no key, up to 25 requests a day; this makes one.
async function cpi() {
  const res = await get("https://api.bls.gov/publicAPI/v1/timeseries/data/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ seriesid: Object.values(CPI), startyear: "2021", endyear: String(new Date().getUTCFullYear()) }),
  });
  const json = await res.json();
  if (json.status !== "REQUEST_SUCCEEDED") throw new Error(`BLS: ${json.status} ${json.message?.join(" ")}`);
  const out = {};
  for (const [key, id] of Object.entries(CPI)) {
    const series = json.Results.series.find((s) => s.seriesID === id);
    out[key] = Object.fromEntries((series?.data || [])
      .filter((d) => /^M(0[1-9]|1[0-2])$/.test(d.period) && Number(d.value)) // "-" = not collected (Oct 2025 shutdown)
      .map((d) => [`${d.year}-${d.period.slice(1)}`, Number(d.value)]));
  }
  return out;
}

// EIA's monthly history page: one row per year, Jan–Dec cells.
async function gas() {
  const res = await get("https://www.eia.gov/dnav/pet/hist/LeafHandler.ashx?n=PET&s=EMM_EPMR_PTE_R1Z_DPG&f=M");
  if (!res.ok) throw new Error(`EIA gas: HTTP ${res.status}`);
  const text = (await res.text()).replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ");
  const out = {};
  for (const m of text.matchAll(/\b(20\d\d)((?:\s+[\d.]+){1,12})/g)) {
    m[2].trim().split(/\s+/).forEach((v, i) => { if (Number(v)) out[`${m[1]}-${String(i + 1).padStart(2, "0")}`] = Number(v); });
  }
  if (!out["2021-01"]) throw new Error("EIA gas page changed");
  return out;
}

// Zillow's city file is sorted by size, so Virginia Beach is near the top: stream until its row, then stop.
async function rent() {
  const res = await get("https://files.zillowstatic.com/research/public_csvs/zori/City_zori_uc_sfrcondomfr_sm_month.csv");
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
        const cells = buf.slice(0, nl).trim().split(",").map((c) => c.replace(/^"|"$/g, ""));
        buf = buf.slice(nl + 1);
        if (!head) { head = cells; continue; }
        if (cells[head.indexOf("RegionName")] === "Virginia Beach" && cells[head.indexOf("State")] === "VA") {
          const out = {};
          head.forEach((h, i) => { if (/^\d{4}-\d{2}-\d{2}$/.test(h) && Number(cells[i])) out[h.slice(0, 7)] = Number(cells[i]); });
          return out;
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  throw new Error("zillow: no Virginia Beach row");
}

// An index value for a month, or the closest earlier month if BLS skipped it (the 2025 shutdown left gaps).
const indexAt = (series, month) => {
  const keys = Object.keys(series).filter((k) => k <= month).sort();
  return keys.length ? series[keys.at(-1)] : null;
};
const yearAvg = (series, year) => {
  const v = Object.entries(series).filter(([k]) => k.startsWith(`${year}-`)).map(([, v]) => v);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

const out = { updated: new Date().toISOString(), failed: [], anchors: ANCHORS, gallons: GAS_GALLONS };
const raw = {};
for (const [key, job] of Object.entries({ wages, cpi, gas, rent })) {
  try {
    raw[key] = await job();
    console.log(`${key}: ok`);
  } catch (e) {
    console.warn(`${key}: ${e.message}`);
    out.failed.push(key);
  }
}
// Any source down: keep yesterday's file rather than writing a half-built one, but mark the failure.
if (out.failed.length) {
  if (previous) {
    writeFileSync(OUT, JSON.stringify({ ...previous, failed: out.failed }, null, 2) + "\n");
    console.warn(`Kept the last good numbers (${out.failed.join(", ")} failed)`);
  }
  process.exit(out.failed.length === 4 ? 1 : 0);
}
out.wages = raw.wages;

// Pay for a month: the average of the four latest published quarters at or before that month's quarter.
const quarters = Object.keys(raw.wages);
const payAt = (month) => {
  const upTo = quarters.filter((q) => q <= quarterOf(month));
  if (upTo.length < 4) return null;
  const last4 = upTo.slice(-4).map((q) => raw.wages[q]);
  return { weekly: last4.reduce((a, b) => a + b, 0) / 4, through: upTo.at(-1) };
};

// The last month every monthly source has reached (rent and CPI usually lag a month or two).
const lastMonth = [raw.rent, raw.gas, ...Object.values(raw.cpi)].map((s) => Object.keys(s).sort().at(-1)).sort()[0];
const g = raw.cpi.groceries, e = raw.cpi.electricity, ins = raw.cpi.insurance;
const base = {
  groceries: g[ANCHORS.groceries.month] || indexAt(g, ANCHORS.groceries.month),
  electricity: yearAvg(e, ANCHORS.electricity.year),
  insurance: yearAvg(ins, ANCHORS.insurance.year),
};

out.months = monthsFrom(START, lastMonth).map((month) => {
  const pay = payAt(month);
  const bills = {
    rent: raw.rent[month] ?? null,
    groceries: ANCHORS.groceries.value * indexAt(g, month) / base.groceries,
    electricity: ANCHORS.electricity.value * indexAt(e, month) / base.electricity,
    insurance: ANCHORS.insurance.value * indexAt(ins, month) / base.insurance,
    gas: raw.gas[month] ? raw.gas[month] * GAS_GALLONS : null,
  };
  if (!pay || Object.values(bills).some((v) => !v)) return null;
  const monthlyPay = (pay.weekly * 52) / 12;
  const total = Object.values(bills).reduce((a, b) => a + b, 0);
  const round = (v) => Math.round(v);
  return {
    month,
    payThrough: pay.through,
    pay: round(monthlyPay),
    bills: Object.fromEntries(Object.entries(bills).map(([k, v]) => [k, round(v)])),
    total: round(total),
    share: Math.round((total / monthlyPay) * 1000) / 10,
  };
}).filter(Boolean);

if (!out.months.length) throw new Error("No month had every number");
const latest = out.months.at(-1);
console.log(`${out.months.length} months; latest ${latest.month}: ${latest.share}% ($${latest.total} of $${latest.pay}, pay through ${latest.payThrough})`);
mkdirSync("data", { recursive: true });
writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
