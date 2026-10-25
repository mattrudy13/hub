// One adapter per app. Each `load()` reads that app's published JSON and returns both wordings of its
// tile: the Scoreboard copy (`sb`) and the Arcade copy (`ar`). Numbers are the same in both. Every
// record mirrors the rule the app itself uses for its headline, so the hub never disagrees with the app;
// the source function is named above each adapter. If a load throws (missing file, changed format),
// the tile falls back to its name and link. That fallback is how an app's data change shows up here.

// Two copies of the same slot; CSS shows the one for the current skin.
const dual = (sb, ar, tag = "span") => `<${tag} class="sb">${sb}</${tag}><${tag} class="ar">${ar}</${tag}>`;

function stat({ big, unit = "", label, subs = [] }) {
  return `<p class="big">${esc(big)}${unit ? `<small>${esc(unit)}</small>` : ""}</p>
    <p class="label">${label}</p>${subs.filter(Boolean).map((s) => `<p class="sub">${s}</p>`).join("")}`;
}

const inMonths = (...months) => () => months.includes(new Date().getMonth() + 1);
const upper = (s) => String(s).toUpperCase();

const TILES = [
  // kotc-tracker index.html: target = tonight's promo, else the next one; picks = the locked p.picks.
  {
    key: "kotc", name: "King of the Court", arcadeName: "KING OF THE COURT", path: "kotc-tracker/", accent: "pink", wide: true,
    staleHours: 30, inSeason: inMonths(10, 11, 12, 1, 2, 3, 4, 5, 6),
    async load() {
      const { data: pred } = await getSeason((y) => `kotc-tracker/data/predictions-${y}.json`);
      const today = todayET();
      const promoDays = Object.keys(pred.days).sort().filter((d) => pred.days[d].promo);
      const target = promoDays.find((d) => d >= today) ?? promoDays.at(-1);
      if (!target) throw new Error("kotc: no promo nights");
      const p = pred.days[target];
      const nameOf = (pid) => pred.names?.[pid]?.n ?? String(pid);
      const byPid = Object.fromEntries((p.players ?? []).map((x) => [x.pid, x]));
      const picks = (p.picks ?? []).map((pid) => ({ name: nameOf(pid), team: pred.names?.[pid]?.t ?? byPid[pid]?.tm ?? "", win: byPid[pid]?.win }));
      const tonight = target === today, over = target < today;
      const pool = p.pool ? `$${p.pool >= 1e6 ? `${p.pool / 1e6}M` : p.pool.toLocaleString("en-US")} pool` : "";
      const facts = [`${p.games} games`, pool].filter(Boolean).join(" · ");

      const rows = picks.length
        ? picks.map((x, i) => `<li><span class="rank">${i + 1}</span>${dual(`${esc(x.name)} <span class="team">${esc(x.team)}</span>`, esc(upper(lastName(x.name))), "span")}<b>${pct(x.win)}</b></li>`).join("")
        : `<li class="empty">${dual("Picks post once the slate is set.", "PICKS LOADING…")}</li>`;

      // Most recent graded promo night (tonight's counts once its result is in).
      const last = promoDays.filter((d) => d <= today && pred.days[d].result).at(-1);
      let lastSb = "", lastAr = "";
      if (last) {
        const lp = pred.days[last], r = lp.result;
        const kings = r.kings.map(nameOf);
        const hits = r.kings.filter((k) => lp.picks?.includes(k)).map(nameOf);
        const n = lp.picks?.length ?? 0;
        const headline = kings.length === 1 ? `${lastName(kings[0])} won` : `${kings.map(lastName).join(" & ")} tied`;
        const ours = !n ? "" : hits.length ? ` ${hits.map(lastName).join(" and ")} ${hits.length === 1 ? "was" : "were"} one of our ${n} picks.` : ` None of our ${n} picks won.`;
        lastSb = `<p class="kicker">Last promo · ${esc(fmtShortDay(last))}</p><p class="headline">${esc(headline)}</p>
          <p>${esc(kings.join(" and "))}, ${r.kingPra} PRA.${esc(ours)}</p>`;
        const arHead = kings.length === 1 ? `${upper(lastName(kings[0]))} WINS!` : `${kings.map((k) => upper(lastName(k))).join(" + ")} TIE!`;
        lastAr = `<p class="kicker">LAST ROUND · ${fmtSlashDay(last)}</p><p class="headline">${esc(arHead)}</p>
          <p>${r.kingPra} PRA. ${n ? (hits.length ? "OUR PICK ✓" : "OUR PICKS MISSED ✗") : ""}</p>`;
      }

      return {
        live: tonight,
        updated: pred.updated,
        tag: dual(tonight ? "Tonight" : over ? "Season over" : `Next · ${esc(fmtDay(target))}`,
          tonight ? "TONIGHT!" : over ? "GAME OVER" : `NEXT: ${esc(upper(dayOf(target).toLocaleDateString(undefined, { weekday: "short" })))} ${fmtSlashDay(target)}`),
        hot: tonight,
        body: `<div class="split">
          <div>${dual(`<p class="kicker">Value picks · ${esc(facts)}</p>`, `<p class="kicker">HIGH SCORES · ${esc(upper(facts))}</p>`, "div")}
            <ol class="board">${rows}</ol>
            ${dual(`<p class="sub">Chance to lead the night in points + rebounds + assists</p>`, `<p class="sub">CHANCE TO LEAD IN PTS + REB + AST</p>`, "div")}</div>
          ${last ? `<div class="aside">${dual(lastSb, lastAr, "div")}</div>` : ""}
        </div>`,
      };
    },
  },

  // nba-first-minute model.html: graded days = days with `result`; Yes games summed over them.
  {
    key: "fm", name: "NBA First Minute", arcadeName: "FIRST MINUTE", path: "nba-first-minute/", accent: "cyan",
    staleHours: 30, inSeason: inMonths(10, 11, 12, 1, 2, 3, 4, 5, 6),
    async load() {
      const { data: pred } = await getSeason((y) => `nba-first-minute/data/predictions-${y}.json`);
      const day = pred.days[todayET()];
      const graded = Object.values(pred.days).filter((x) => x.result);
      const games = graded.reduce((s, x) => s + x.result.games, 0);
      const yes = graded.reduce((s, x) => s + x.result.yes, 0);
      const expected = graded.reduce((s, x) => s + x.yes * x.result.games, 0);
      const recSb = graded.length ? `Graded ${graded.length} day${graded.length === 1 ? "" : "s"}: Yes in ${yes} of ${games} games (estimate said ${expected.toFixed(1)})` : "No graded days yet";
      const recAr = graded.length ? `SCORE: ${yes}/${games} HITS · ${graded.length} DAYS` : "NO SCORES YET";

      if (!day) {
        return {
          updated: pred.updated,
          tag: dual("Today", "TODAY"),
          body: dual(stat({ big: "–", label: "No estimate saved for today (no games, or not run yet)", subs: [recSb] }),
            stat({ big: "–", label: "INSERT COIN: NO ESTIMATE YET", subs: [recAr] }), "div"),
        };
      }
      const slate = day.games.slice(0, 4).map((g) => `${esc(g.away)} @ ${esc(g.home)} ${esc(fmtTime(g.tip))}`).join(" · ") + (day.games.length > 4 ? ` · +${day.games.length - 4} more` : "");
      const saved = new Date(day.takenAt) <= new Date(day.firstTip) ? "Saved before tip-off" : "Saved";
      return {
        live: true, hot: true,
        updated: pred.updated,
        tag: dual("Tonight", "TONIGHT"),
        body: dual(
          stat({ big: pct(day.yes), label: "Chance both teams score in the first minute", subs: [slate, `${saved} · ${recSb}`] }),
          stat({ big: pct(day.yes), label: "BOTH TEAMS SCORE IN MINUTE 1", subs: [`${day.games.length} GAME${day.games.length === 1 ? "" : "S"} ON THE BOARD`, recAr] }), "div"),
      };
    },
  },

  // cfb-picks index.html: the current model's spreads, recordOf() in common.js; status = newest spread's.
  {
    key: "cfb", name: "College Football Picks", arcadeName: "CFB PICKS", path: "cfb-picks/", accent: "lime",
    staleHours: 60, inSeason: inMonths(9, 10, 11, 12),
    async load() {
      const { data } = await getSeason((y) => `cfb-picks/data/picks-${y}.json`);
      const all = Object.values(data.weeks ?? {}).flatMap((w) => w.picks);
      if (!all.length) throw new Error("cfb: no picks");
      const model = [...all].sort((a, b) => b.takenAt.localeCompare(a.takenAt))[0].model ?? "v2";
      const mine = all.filter((p) => (p.model ?? "v2") === model);
      const spreads = mine.filter((p) => p.cat === "spread");
      const w = spreads.filter((p) => p.result === "W").length, l = spreads.filter((p) => p.result === "L").length;
      const push = spreads.filter((p) => p.result === "P").length;
      const newest = [...spreads].sort((a, b) => b.takenAt.localeCompare(a.takenAt))[0];
      const status = newest?.status ?? (newest?.shadow ? "unofficial" : "official");
      const week = Math.max(...mine.map((p) => p.week));
      const thisWeek = mine.filter((p) => p.week === week);
      const open = thisWeek.filter((p) => !p.result);
      const now = Date.now();
      const next = open.map((p) => p.kickoff).filter((k) => new Date(k) > now).sort()[0];
      const lastKick = mine.map((p) => p.kickoff).sort().at(-1);
      const offseason = !open.length && now - new Date(lastKick) > 21 * 864e5;
      const rate = w + l ? w / (w + l) : null;
      const big = push ? wl(w, l, push) : wl(w, l);
      return {
        live: open.some((p) => etDate(new Date(p.kickoff)) === todayET()),
        updated: data.updated,
        tag: dual(offseason ? "Offseason" : `Week ${week}`, offseason ? "GAME OVER" : `LEVEL: WEEK ${week}`),
        body: dual(
          stat({ big, label: `Model ${esc(model)} spreads, ${esc(status)} · ${pct(rate)} (52.4% breaks even)`,
            subs: [offseason ? "Final record for the season" : `${thisWeek.length} picks this week · ${open.length} open${next ? ` · next kickoff ${esc(fmtKick(next))}` : ""}`] }),
          stat({ big, label: `${esc(upper(model))} · ${pct(rate)} WIN RATE · NEED 52.4%`,
            subs: [offseason ? "FINAL SCORE" : `${open.length} PICKS IN PLAY${next ? ` · KICKOFF ${esc(upper(fmtKick(next)))}` : ""}`] }), "div"),
      };
    },
  },

  // beat-the-model: the Worker's /api/summary, built by summary() in the app's lib/rules.js (same as its
  // race summary). Everyone is graded on Rudy's picks, so "vs the Model" is a head-to-head.
  {
    key: "btm", name: "Beat the Model", arcadeName: "BEAT THE MODEL", path: "beat-the-model/", accent: "yellow",
    staleHours: 3, inSeason: inMonths(9, 10, 11, 12),
    async load() {
      const res = await fetch("https://beat-the-model.mattrudy13.workers.dev/api/summary", { cache: "no-cache" });
      if (!res.ok) throw new Error(`btm: HTTP ${res.status}`);
      const s = await res.json();
      const diff = s.you.w - s.model.w;
      const lead = !s.graded ? "No graded picks yet" : diff === 0 ? "Even with the Model" : diff > 0 ? `${diff} up on the Model` : `${-diff} behind the Model`;
      const arLead = !s.graded ? "PRESS START" : diff === 0 ? "TIED WITH THE MODEL" : diff > 0 ? `${diff} AHEAD OF THE MODEL` : `${-diff} BEHIND THE MODEL`;
      const week = s.open
        ? `Week ${s.week}: ${s.pickedOpen} of ${s.open} open games picked${s.nextLock ? ` · next lock ${esc(fmtKick(s.nextLock))}` : ""}`
        : `Week ${s.week}: no open games`;
      const arWeek = s.open ? `${s.pickedOpen}/${s.open} PICKED${s.nextLock ? ` · LOCK ${esc(upper(fmtKick(s.nextLock)))}` : ""}` : "NO GAMES OPEN";
      const today = !!s.nextLock && etDate(new Date(s.nextLock)) === todayET();
      return {
        live: today,
        hot: today,
        updated: s.syncedAt,
        tag: dual(`Week ${s.week}`, `LEVEL: WEEK ${s.week}`),
        body: dual(
          stat({ big: wl(s.you.w, s.you.l, s.you.p), label: s.graded ? `${lead} (Model ${wl(s.model.w, s.model.l, s.model.p)} on my games) · rank ${s.rank} of ${s.players}` : `${lead} · vs the Model and 6 bots`, subs: [week] }),
          stat({ big: wl(s.you.w, s.you.l, s.you.p), label: `${arLead} · RANK ${s.rank}/${s.players}`, subs: [arWeek] }), "div"),
      };
    },
  },

  // te-tracker index.html renderRecord(): official = graded && !shadow, one line per category; fades apart
  // because a fade "wins" (no TD) most of the time with no skill.
  {
    key: "te", name: "NFL Tight End TDs", arcadeName: "TE TOUCHDOWNS", path: "te-tracker/", accent: "cyan",
    staleHours: 100, inSeason: inMonths(9, 10, 11, 12, 1),
    async load() {
      const { data } = await getSeason((y) => `te-tracker/data/picks-${y}.json`);
      const all = Object.entries(data.weeks ?? {}).flatMap(([wk, x]) => x.picks.map((p) => ({ ...p, week: +wk })));
      const official = all.filter((p) => !p.shadow);
      if (!official.length) throw new Error("te: no picks");
      const graded = official.filter((p) => p.result);
      const cats = [["likely", "Likely"], ["value", "Value"], ["longshot", "Long shot"], ["due", "Due"], ["first", "First TD"], ["fade", "Fades"]];
      const parts = cats.map(([k, label]) => {
        const g = graded.filter((p) => p.cat === k);
        return g.length ? `${label} ${wl(g.filter((p) => p.result === "won").length, g.filter((p) => p.result === "lost").length)}` : null;
      }).filter(Boolean);
      const week = Math.max(...official.map((p) => p.week));
      const thisWeek = official.filter((p) => p.week === week);
      const open = thisWeek.filter((p) => !p.result);
      const now = Date.now();
      const next = open.map((p) => p.kickoff).filter((k) => new Date(k) > now).sort()[0];
      const lastKick = official.map((p) => p.kickoff).sort().at(-1);
      const offseason = !open.length && now - new Date(lastKick) > 21 * 864e5;
      const updated = [data.updated, data.graded].filter(Boolean).sort().at(-1);
      const record = parts.length ? parts.join(" · ") : "No graded picks yet";
      return {
        live: open.some((p) => etDate(new Date(p.kickoff)) === todayET()),
        updated,
        tag: dual(offseason ? "Offseason" : `Week ${week}`, offseason ? "GAME OVER" : `LEVEL: WEEK ${week}`),
        body: dual(
          stat({ big: String(thisWeek.length), label: offseason ? `Picks in the final week (${week})` : `Picks for week ${week}${open.length ? ` · ${open.length} open` : ""}${next ? ` · next kickoff ${esc(fmtKick(next))}` : ""}`,
            subs: [`Season: ${esc(record)}`, parts.length ? "Fades win when the player doesn't score." : ""] }),
          stat({ big: String(thisWeek.length), label: "PICKS ON THE BOARD", subs: [esc(upper(record))] }), "div"),
      };
    },
  },

  // uva-records: records from seasons.json (the dashboard's source); "in season" = still has a next game.
  {
    key: "uva", name: "UVA Records", arcadeName: "UVA RECORDS", path: "uva-records/", accent: "yellow",
    staleHours: null,
    async load() {
      const [meta, seasons] = await Promise.all([getJson("uva-records/site-data/sports.json"), getJson("uva-records/site-data/seasons.json")]);
      const entry = (s) => seasons[s.slug]?.find((x) => x.season === s.current_label);
      const month = new Date().getMonth() + 1;
      const wanted = month <= 3 ? "mbball" : month <= 6 ? "baseball" : "football";
      const sport = meta.sports.find((s) => s.slug === wanted && entry(s)) ?? meta.sports.find((s) => entry(s)?.next);
      if (!sport) throw new Error("uva: no current season");
      const cur = entry(sport);
      const games = await getJson(`uva-records/site-data/games/${sport.slug}.json`);
      const lastGame = games.filter((g) => g.s === sport.current_label && g.r).sort((a, b) => a.d.localeCompare(b.d)).at(-1);
      const lastText = (arcade) => {
        if (!lastGame) return arcade ? "NO GAMES YET" : "No games yet";
        const where = lastGame.v === "a" ? (arcade ? "@" : "at") : "vs";
        const rank = lastGame.ork ? (arcade ? `#${lastGame.ork} ` : `No. ${lastGame.ork} `) : "";
        return `${lastGame.r} ${lastGame.u}–${lastGame.p} ${where} ${rank}${lastGame.o}`;
      };
      const active = meta.sports.filter((s) => entry(s)?.next);
      const sum = (k) => active.reduce((n, s) => n + entry(s).record[k], 0);
      const total = wl(sum("w"), sum("l"), sum("t"));
      const today = todayET();
      const playingToday = active.filter((s) => entry(s).next === today).length;
      const term = sport.term[0].toUpperCase() + sport.term.slice(1);
      const nextLine = cur.next ? (cur.next === today ? "Plays today" : `Next game ${fmtDay(cur.next)}`) : "Season over";
      const built = meta.built;
      return {
        live: playingToday > 0,
        when: `Updated ${built === today ? "today" : fmtShortDay(built)}`,
        arWhen: `SAVED ${built === today ? "TODAY" : fmtSlashDay(built)}`,
        late: (Date.now() - dayOf(built)) / 864e5 > 2.5,
        tag: dual(`${term} ${esc(sport.current_label)}`, `SEASON ${esc(sport.current_label)}`),
        body: dual(
          stat({ big: wl(cur.record.w, cur.record.l, cur.record.t), label: `${esc(sport.name)} · last: ${esc(lastText(false))}`,
            subs: [active.length ? `${active.length} teams with games left: ${total}${playingToday ? ` · ${playingToday} playing today` : ""}` : "", esc(nextLine)] }),
          stat({ big: wl(cur.record.w, cur.record.l, cur.record.t), label: `${esc(upper(sport.name))} · LAST: ${esc(upper(lastText(true)))}`,
            subs: [active.length ? `ALL ACTIVE TEAMS: ${total}` : "", esc(upper(nextLine))] }), "div"),
      };
    },
  },

  // apartments index.html (renderViable): viable units from viable.json; `monthly` is the same number
  // the site and the email digest rank by.
  {
    key: "apts", name: "Apartments", arcadeName: "APARTMENTS", path: "apartments/", accent: "lime",
    staleHours: null,
    async load() {
      const [viable, summary] = await Promise.all([getJson("apartments/data/viable.json"), getJson("apartments/data/summary.json")]);
      const lastPull = summary.complexes.map((c) => c.date).filter(Boolean).sort().at(-1);
      const units = viable.units ?? [];
      const max = viable.criteria?.max_monthly;
      const common = { when: lastPull ? `Pulled ${fmtDay(lastPull)}` : "", arWhen: lastPull ? `SCRAPED ${fmtSlashDay(lastPull)}` : "",
        late: lastPull ? (Date.now() - dayOf(lastPull)) / 864e5 > 9 : false, tag: dual("Weekly", "BEST PRICE") };
      if (!units.length) {
        return { ...common, body: dual(stat({ big: "0", label: `Viable units under ${money(max)}/mo` }), stat({ big: "0", label: "NO LOOT THIS WEEK" }), "div") };
      }
      const best = [...units].sort((a, b) => a.monthly - b.monthly)[0];
      const complexes = new Set(units.map((u) => u.slug)).size;
      const fees = best.fees_known === false ? " · fees not listed" : "";
      return {
        ...common,
        body: dual(
          stat({ big: money(best.monthly), unit: "/mo", label: `${esc(best.complex)} · ${best.beds} BR${fees}`,
            subs: [`${units.length} viable units at ${complexes} complexes, under ${money(max)}/mo`] }),
          stat({ big: money(best.monthly), label: `${esc(upper(best.complex))} · ${best.beds} BR${upper(fees)}`,
            subs: [`${units.length} UNITS UNLOCKED UNDER ${money(max)}`] }), "div"),
      };
    },
  },

  // h2h has no daily data: the tile is a lookup that opens the app's own ?t1=&t2= link.
  {
    key: "h2h", name: "Head to Head", arcadeName: "HEAD TO HEAD", path: "h2h/", accent: "pink", h2h: true,
    staleHours: null,
    async load() {
      return {
        tag: dual("Lookup", "VS MODE"),
        footer: dual("All-time series, any two teams", "PICK YOUR FIGHTERS"),
        body: `<form class="h2h" id="h2h-form">
          <label>${dual("Sport", "GAME")}<select name="sport"><option value="cfb">Football</option><option value="cbb">Men's basketball</option></select></label>
          <label>${dual("Team 1", "PLAYER 1")}<input name="t1" type="text" autocomplete="off" required placeholder="Virginia"></label>
          <label>${dual("Team 2", "PLAYER 2")}<input name="t2" type="text" autocomplete="off" required placeholder="Virginia Tech"></label>
          <button type="submit">${dual("Show the series", "FIGHT!")}</button>
        </form>`,
        after(el) {
          el.querySelector("#h2h-form").addEventListener("submit", (e) => {
            e.preventDefault();
            const f = new FormData(e.target);
            const q = new URLSearchParams({ t1: f.get("t1").trim(), t2: f.get("t2").trim() });
            location.href = appUrl(`h2h/${f.get("sport")}-h2h.html?${q}`);
          });
        },
      };
    },
  },
];

function tileShell(t) {
  return `<article class="tile${t.wide ? " wide" : ""}${t.h2h ? " h2h-tile" : ""}" id="tile-${t.key}" data-accent="${t.accent}" aria-busy="true">
    <header class="tile-head"><h2>${dual(esc(t.name), esc(t.arcadeName))}</h2><span class="tag"></span></header>
    <div class="tile-body"><p class="sub">${dual("Loading…", "LOADING…")}</p></div>
    <footer class="tile-foot"><span class="when"></span><a href="${appUrl(t.path)}" target="_blank" rel="noopener" aria-label="Open ${esc(t.name)} in a new tab">${dual("Open →", "▶ PLAY")}</a></footer>
  </article>`;
}

async function fillTile(t) {
  const el = document.getElementById(`tile-${t.key}`);
  try {
    const r = await t.load();
    el.querySelector(".tag").innerHTML = r.tag ?? "";
    el.querySelector(".tag").classList.toggle("hot", !!r.hot);
    el.querySelector(".tile-body").innerHTML = r.body;
    const late = r.late ?? (t.staleHours != null && r.updated && t.inSeason?.() && hoursSince(r.updated) > t.staleHours);
    const sbWhen = r.when ?? (r.updated ? `Updated ${ago(r.updated)}` : "");
    const arWhen = r.arWhen ?? (r.updated ? `SAVED ${upper(ago(r.updated))}` : "");
    el.querySelector(".when").innerHTML = r.footer ?? (dual(esc(sbWhen), esc(arWhen)) + (late ? ` <span class="late">${dual("Running late", "LAG!")}</span>` : ""));
    r.after?.(el);
    return r;
  } catch (e) {
    console.warn(`[hub] ${t.key} tile fell back to a link:`, e);
    el.classList.add("failed");
    el.querySelector(".tile-body").innerHTML = `<p class="label">${dual("Couldn't read today's data. The app itself may still be fine.", "NO SIGNAL. THE GAME MAY STILL WORK.")}</p>`;
    return null;
  } finally {
    el.removeAttribute("aria-busy");
  }
}

async function renderTiles() {
  const grid = document.getElementById("tiles");
  grid.innerHTML = TILES.map(tileShell).join("");
  const results = await Promise.all(TILES.map(fillTile));
  const live = results.filter((r) => r?.live).length;
  const day = new Date().toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
  document.getElementById("subline").innerHTML = dual(
    esc(`${day} · ${TILES.length} apps${live ? ` · ${live} with games today` : ""}`),
    esc(upper(`${day} · ${TILES.length} games loaded${live ? ` · ${live} playing today` : ""}`)));
}
