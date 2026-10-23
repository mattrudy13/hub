// Latest full-length uploads for the channels in channels.txt (one channel URL or @handle per line;
// # starts a comment). Writes data/youtube.json for the Daily page.
//
// Uses the YouTube Data API (key in the YOUTUBE_API_KEY secret) because YouTube's public channel feeds
// were returning 404s and 500s in Oct 2026. Each channel costs 2 quota units per run (channel lookup +
// its long-form playlist) out of 10,000 a day. The long-form playlist (UULF…) leaves out Shorts and
// live streams. Node 22, no packages. Usage: YOUTUBE_API_KEY=… node scripts/youtube.mjs

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const OUT = "data/youtube.json";
const VIDEOS_PER_CHANNEL = 5;
const KEY = process.env.YOUTUBE_API_KEY;
if (!KEY) {
  console.log("YOUTUBE_API_KEY isn't set, so YouTube is skipped");
  process.exit(0);
}

async function api(method, params) {
  const res = await fetch(`https://www.googleapis.com/youtube/v3/${method}?${new URLSearchParams({ ...params, key: KEY })}`, { signal: AbortSignal.timeout(20000) });
  const body = await res.json().catch(() => ({}));
  // Errors name the method only, never the URL, so the key can't end up in a log.
  if (!res.ok) throw Object.assign(new Error(`${method}: HTTP ${res.status} ${body.error?.errors?.[0]?.reason ?? ""}`), { status: res.status });
  return body;
}

const wanted = readFileSync("channels.txt", "utf8").split("\n").map((l) => l.replace(/#.*/, "").trim()).filter(Boolean).map((l) => {
  const id = l.match(/channel\/(UC[\w-]{22})/)?.[1];
  const handle = l.match(/@([\w.-]+)/)?.[1];
  if (!id && !handle) throw new Error(`channels.txt: can't read "${l}" (use a channel URL or @handle)`);
  return { line: l, id, handle };
});

let previous = null;
try { previous = JSON.parse(readFileSync(OUT, "utf8")); } catch {}
// When each video first showed up here. The page's NEW badge compares this (not the upload time) with
// the last visit, because a video can reach this file up to an hour after it's posted.
const firstSeen = new Map((previous?.channels ?? []).flatMap((c) => c.videos.map((v) => [v.id, v.seen])));
const now = new Date().toISOString();

const channels = [], failed = [];
for (const w of wanted) {
  try {
    const found = await api("channels", { part: "snippet", ...(w.id ? { id: w.id } : { forHandle: `@${w.handle}` }) });
    const ch = found.items?.[0];
    if (!ch) throw new Error("channel not found");
    let videos = [];
    try {
      const list = await api("playlistItems", { part: "snippet,contentDetails", playlistId: `UULF${ch.id.slice(2)}`, maxResults: VIDEOS_PER_CHANNEL });
      videos = list.items.map((v) => ({
        id: v.contentDetails.videoId,
        title: v.snippet.title,
        published: v.contentDetails.videoPublishedAt ?? v.snippet.publishedAt,
        thumb: v.snippet.thumbnails?.medium?.url ?? v.snippet.thumbnails?.default?.url ?? null,
      })).map((v) => ({
        ...v,
        // With no earlier file (first run, or a newly added channel) there's no history, so use the upload time.
        seen: firstSeen.get(v.id) ?? (previous && previous.channels.some((c) => c.id === ch.id) ? now : v.published),
      })).sort((a, b) => b.published.localeCompare(a.published));
    } catch (e) {
      // A channel with no full-length uploads has no long-form playlist at all.
      if (e.status !== 404) throw e;
    }
    channels.push({
      id: ch.id,
      handle: ch.snippet.customUrl ?? (w.handle ? `@${w.handle}` : null),
      name: ch.snippet.title,
      thumb: ch.snippet.thumbnails?.default?.url ?? null,
      videos,
    });
    console.log(`${ch.snippet.title}: newest ${videos[0]?.published ?? "none"}`);
  } catch (e) {
    console.warn(`${w.line}: ${e.message}`);
    failed.push(w.line);
    // Keep the last run's entry so the channel doesn't vanish from the page.
    const old = previous?.channels?.find((c) => (w.id && c.id === w.id) || (w.handle && c.handle?.toLowerCase() === `@${w.handle.toLowerCase()}`));
    if (old) channels.push(old);
  }
}

mkdirSync("data", { recursive: true });
writeFileSync(OUT, JSON.stringify({ updated: new Date().toISOString(), failed, channels }, null, 2) + "\n");
if (wanted.length && failed.length === wanted.length) {
  console.error("Every channel failed (bad key or quota?)");
  process.exit(1);
}
