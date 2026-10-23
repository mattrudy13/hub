// Shared helpers: data loading, dates and formatting, plus the theme and Arcade mode toggles.
// Plain globals, no build step (same convention as the app repos).

// The apps live on mattrudy13.github.io. Away from it (local preview), read their live data cross-origin,
// which GitHub Pages allows, so dev never depends on local copies or on apartments' site/ folder layout.
const BASE = location.hostname === "mattrudy13.github.io" ? "" : "https://mattrudy13.github.io";
const appUrl = (path) => `https://mattrudy13.github.io/${path}`;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

async function getJson(path) {
  const res = await fetch(`${BASE}/${path}`, { cache: "no-cache" });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

// Season files are named by the year the season starts (2026 = 2026-27). Before a new season's file
// exists, fall back to the previous one so the tile can show the final record.
async function getSeason(pathFor) {
  const now = new Date();
  const year = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  try {
    return { season: year, data: await getJson(pathFor(year)) };
  } catch (e) {
    return { season: year - 1, data: await getJson(pathFor(year - 1)) };
  }
}

// ---- Dates ----

// The apps' day keys are Eastern dates (the leagues schedule in ET).
const etDate = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);
const todayET = () => etDate();
// A YYYY-MM-DD key as a local date at noon, so formatting never slips a day.
const dayOf = (key) => new Date(`${key}T12:00:00`);

const fmtDay = (key) => dayOf(key).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
const fmtShortDay = (key) => dayOf(key).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const fmtSlashDay = (key) => { const d = dayOf(key); return `${d.getMonth() + 1}/${d.getDate()}`; };
const fmtTime = (iso) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const fmtKick = (iso) => new Date(iso).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });

function ago(iso) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 36) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
const hoursSince = (iso) => (Date.now() - new Date(iso).getTime()) / 3600000;

// ---- Numbers ----

const pct = (x, digits = 1) => (x == null ? "–" : `${(x * 100).toFixed(digits)}%`);
const money = (x) => (x == null ? "–" : `$${Math.round(x).toLocaleString("en-US")}`);
const wl = (w, l, t = 0) => (t ? `${w}–${l}–${t}` : `${w}–${l}`);
const lastName = (name) => String(name).replace(/\s+(Jr\.|Sr\.|II|III|IV)$/, "").split(" ").pop();

// ---- Theme and Arcade mode ----

function setupToggles() {
  const root = document.documentElement;
  const themeBtn = document.getElementById("theme");
  const arcadeBtn = document.getElementById("arcade");
  const currentTheme = () => root.dataset.theme ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");

  const labelTheme = () => {
    const dark = currentTheme() === "dark";
    themeBtn.querySelector(".sun").hidden = !dark;
    themeBtn.querySelector(".moon").hidden = dark;
    themeBtn.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
  };
  themeBtn.addEventListener("click", () => {
    const next = currentTheme() === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    try { localStorage.setItem("hub:theme", next); } catch {}
    labelTheme();
  });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", labelTheme);
  labelTheme();

  // Arcade mode is deliberately not saved: every visit opens on the Scoreboard.
  let fontsLoaded = false;
  arcadeBtn.addEventListener("click", () => {
    const on = root.dataset.skin !== "arcade";
    if (on && !fontsLoaded) {
      // Arcade fonts load only when someone turns it on.
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "https://fonts.googleapis.com/css2?family=Press+Start+2P&family=VT323&display=swap";
      document.head.append(link);
      fontsLoaded = true;
    }
    if (on && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      document.body.classList.remove("crt");
      void document.body.offsetWidth; // restart the animation if toggled quickly
      document.body.classList.add("crt");
      setTimeout(() => document.body.classList.remove("crt"), 400);
    }
    if (on) root.dataset.skin = "arcade";
    else delete root.dataset.skin;
    arcadeBtn.setAttribute("aria-pressed", String(on));
  });
}
