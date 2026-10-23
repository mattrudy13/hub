// "Recently updated" ticker: recent commits from every app repo via the public GitHub API.
// Data refreshes (`data:` or `chore(data):`) collapse into one row per run of them; feat/fix/refactor/perf
// show their subject; docs, chore and style commits are left out so the feed reads like a changelog.
// Unauthenticated calls are limited to 60 an hour per visitor, so results are cached for 10 minutes.

const REPOS = [
  ["cfb-picks", "CFB Picks", "CFB"],
  ["te-tracker", "NFL TE TDs", "TE"],
  ["kotc-tracker", "King of the Court", "KOTC"],
  ["nba-first-minute", "NBA First Minute", "FIRST MINUTE"],
  ["uva-records", "UVA Records", "UVA"],
  ["h2h", "Head to Head", "H2H"],
  ["apartments", "Apartments", "APARTMENTS"],
];
const FEED_KEY = "hub:feed:v1";
const FEED_TTL = 10 * 60 * 1000;
const FEED_ROWS = 8;

function classify(message) {
  const m = message.split("\n")[0].match(/^(\w+)(?:\(([^)]*)\))?!?:\s*(.+)$/);
  if (!m) return null;
  const [, type, scope, subject] = m;
  if (type === "data" || scope === "data") return { kind: "data" };
  if (["feat", "fix", "refactor", "perf"].includes(type)) return { kind: "change", text: subject };
  return null;
}

async function repoItems([repo]) {
  const res = await fetch(`https://api.github.com/repos/mattrudy13/${repo}/commits?per_page=15`, { headers: { Accept: "application/vnd.github+json" } });
  if (!res.ok) throw new Error(`${repo}: HTTP ${res.status}`);
  const items = [];
  for (const c of await res.json()) {
    const k = classify(c.commit.message);
    if (!k) continue;
    const date = c.commit.committer?.date ?? c.commit.author?.date;
    const prev = items.at(-1);
    // Newest first, so a run of refreshes keeps the newest date and counts the rest.
    if (k.kind === "data" && prev?.kind === "data") prev.count++;
    else items.push({ repo, date, count: 1, ...k });
  }
  return items;
}

async function loadFeed() {
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem(FEED_KEY)); } catch {}
  if (cached && Date.now() - cached.at < FEED_TTL) return cached.items;

  const settled = await Promise.allSettled(REPOS.map(repoItems));
  const ok = settled.filter((s) => s.status === "fulfilled");
  // Rate-limited or offline: keep showing the last good feed rather than a partial one.
  if (ok.length < settled.length && cached) return cached.items;
  if (!ok.length) return null;
  const items = ok.flatMap((s) => s.value).sort((a, b) => b.date.localeCompare(a.date)).slice(0, FEED_ROWS);
  try { localStorage.setItem(FEED_KEY, JSON.stringify({ at: Date.now(), items })); } catch {}
  return items;
}

function feedRow(it) {
  const [, name, short] = REPOS.find(([r]) => r === it.repo) ?? [it.repo, it.repo, it.repo];
  const recent = hoursSince(it.date) < 36;
  const when = recent ? ago(it.date) : fmtShortDay(etDate(new Date(it.date)));
  const sbText = it.kind === "data" ? `data refreshed${it.count > 1 ? ` ${it.count}×` : ""}` : it.text;
  return `<li>${dual(`<b>${esc(name)}</b> ${esc(sbText)} · ${esc(when)}`, `★ ${esc(short)} ${esc(upper(sbText))} · ${esc(upper(when))}`)}</li>`;
}

async function renderFeed() {
  const bar = document.getElementById("ticker");
  const items = await loadFeed().catch(() => null);
  if (!items?.length) { bar.hidden = true; return; }
  const rows = items.map(feedRow).join("");
  // The list is doubled so the scroll loops without a gap; the copy is hidden from screen readers.
  bar.querySelector(".ticker-track").innerHTML = `<ul>${rows}</ul><ul aria-hidden="true">${rows}</ul>`;
  bar.style.setProperty("--ticker-seconds", `${Math.max(30, items.length * 7)}s`);
  bar.hidden = false;

  const pause = document.getElementById("ticker-pause");
  pause.addEventListener("click", () => {
    const paused = bar.classList.toggle("paused");
    pause.setAttribute("aria-pressed", String(paused));
    pause.setAttribute("aria-label", paused ? "Play the ticker" : "Pause the ticker");
  });
}
