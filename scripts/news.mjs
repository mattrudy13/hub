// Headlines for the Daily page: reads each section's RSS/Atom feeds and writes data/news.json.
// Runs in GitHub Actions because the news sites don't allow browser requests (no CORS headers).
// Node 22, no packages. Usage: node scripts/news.mjs

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const OUT = "data/news.json";
const SECTIONS = [
  { key: "world", name: "US & World", feeds: [
    ["NPR", "https://feeds.npr.org/1001/rss.xml"],
    ["BBC", "https://feeds.bbci.co.uk/news/world/rss.xml"],
  ] },
  { key: "business", name: "Business", feeds: [
    ["CNBC", "https://www.cnbc.com/id/10001147/device/rss/rss.html"],
    ["MarketWatch", "https://feeds.content.dowjones.io/public/rss/mw_bulletins"],
  ] },
  { key: "tech", name: "Tech", feeds: [
    ["The Verge", "https://www.theverge.com/rss/index.xml"],
    ["Ars Technica", "https://feeds.arstechnica.com/arstechnica/index"],
  ] },
];
const PER_SECTION = 5;
// Newest first would let a busy feed (BBC posts ~3× as often as NPR) fill a whole section.
const PER_SOURCE = 3;

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) =>
  e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e.toLowerCase()] ?? m);
// Some feeds escape their HTML and some wrap it in CDATA, so decode, strip tags, then decode once more.
const clean = (s = "") => decode(decode(s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")).replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
const field = (block, name) => block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`))?.[1];

function parseFeed(xml, source) {
  const blocks = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/g) ?? [];
  return blocks.map((b) => {
    const title = clean(field(b, "title"));
    // RSS: <link>url</link>. Atom: <link rel="alternate" href="url"/>.
    const link = clean(b.match(/<link>([\s\S]*?)<\/link>/)?.[1]) || decode(b.match(/<link[^>]*?href="([^"]+)"/)?.[1] ?? "");
    const when = clean(field(b, "pubDate") ?? field(b, "published") ?? field(b, "updated") ?? field(b, "dc:date"));
    const t = Date.parse(when);
    return { title, link, source, published: Number.isNaN(t) ? null : new Date(t).toISOString() };
  }).filter((x) => x.title && /^https?:\/\//.test(x.link) && x.published);
}

async function readFeed([source, url]) {
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (rudy-hub daily headlines)" }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const items = parseFeed(await res.text(), source);
  if (!items.length) throw new Error("no items parsed (format changed?)");
  return items;
}

function pick(items) {
  const seen = new Set(), perSource = {}, out = [];
  for (const x of [...items].sort((a, b) => b.published.localeCompare(a.published))) {
    const key = x.title.toLowerCase();
    if (seen.has(key) || (perSource[x.source] ?? 0) >= PER_SOURCE) continue;
    seen.add(key);
    perSource[x.source] = (perSource[x.source] ?? 0) + 1;
    out.push(x);
    if (out.length === PER_SECTION) break;
  }
  return out;
}

let previous = {};
try { previous = JSON.parse(readFileSync(OUT, "utf8")); } catch {}

const failed = [];
const sections = [];
for (const s of SECTIONS) {
  const pool = [];
  for (const feed of s.feeds) {
    try {
      pool.push(...await readFeed(feed));
    } catch (e) {
      // Keep the last run's headlines from this source so one bad feed doesn't empty a section.
      console.warn(`${feed[0]}: ${e.message}`);
      failed.push(feed[0]);
      pool.push(...(previous.sections?.find((p) => p.key === s.key)?.items ?? []).filter((x) => x.source === feed[0]));
    }
  }
  sections.push({ key: s.key, name: s.name, items: pick(pool) });
  console.log(`${s.name}: ${sections.at(-1).items.length} headlines`);
}

mkdirSync("data", { recursive: true });
writeFileSync(OUT, JSON.stringify({ updated: new Date().toISOString(), failed, sections }, null, 2) + "\n");
if (failed.length === SECTIONS.flatMap((s) => s.feeds).length) {
  console.error("Every feed failed");
  process.exit(1);
}
