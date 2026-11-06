// The Board's footer "Alerts" link: turns push alerts on or off for this device. Just Rudy's devices: turning
// them on needs the passphrase (the hub-push Worker's PUSH_KEY). The Worker (push/) decides what to send.
// On localhost (preview), the local `wrangler dev` of push/ on port 8799 instead.
const PUSH_API = location.hostname === "localhost" ? "http://localhost:8799" : "https://hub-push.mattrudy13.workers.dev";

async function setupAlerts() {
  const btn = document.getElementById("alerts-btn"), panel = document.getElementById("alerts-panel");
  if (!btn || !panel) return;
  const canPush = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  // Safari on iPhone outside the home-screen app: navigator.standalone exists but is false, and there's no push.
  const iosTab = !canPush && navigator.standalone === false;
  if (!canPush && !iosTab) return; // the link stays hidden where alerts can't work
  btn.hidden = false;

  let reg = null;
  if (canPush) {
    try { reg = await navigator.serviceWorker.register("sw.js"); }
    catch (e) { console.warn("[alerts] service worker:", e); return; }
  }
  const currentSub = async () => (reg ? reg.pushManager.getSubscription() : null);

  const label = (on) => {
    btn.querySelector(".sb").textContent = `Alerts: ${on ? "on" : "off"}`;
    btn.querySelector(".ar").textContent = `ALERTS: ${on ? "ON" : "OFF"}`;
  };
  const say = (text) => { const s = panel.querySelector(".alerts-msg"); if (s) s.textContent = text; };
  const post = async (path, body) => {
    const res = await fetch(`${PUSH_API}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) };
  };

  async function render() {
    const sub = await currentSub();
    label(!!sub);
    if (iosTab) {
      panel.innerHTML = `<p>Alerts only work in the home-screen app. In Safari, tap Share, then Add to Home Screen, and open the Board from there.</p>`;
    } else if (Notification.permission === "denied") {
      panel.innerHTML = `<p>Notifications are blocked for the Board. Turn them back on in Settings › Notifications › Board, then reopen it.</p>`;
    } else if (sub) {
      panel.innerHTML = `<p>On for this device: Beat the Model, King of the Court, UVA games and data jobs. Data-job alerts wait out 11 PM–7 AM.</p>
        <div class="alerts-row"><button type="button" data-act="test">Send a test</button><button type="button" data-act="off">Turn off</button></div>
        <p class="alerts-msg" role="status"></p>`;
    } else {
      panel.innerHTML = `<form class="alerts-row" data-act="on">
          <label class="sr-only" for="alerts-key">Passphrase</label>
          <input id="alerts-key" type="password" autocomplete="off" placeholder="Passphrase" required>
          <button type="submit">Turn on</button>
        </form>
        <p class="alerts-msg" role="status"></p>`;
    }
  }

  async function turnOn(key) {
    // First thing in the tap: iOS only shows the permission prompt in direct response to one.
    const perm = await Notification.requestPermission();
    if (perm !== "granted") { await render(); say(perm === "denied" ? "" : "Allow notifications to turn alerts on."); return; }
    say("Turning on…");
    let sub = null;
    try {
      const { vapidPublicKey } = await (await fetch(`${PUSH_API}/config`)).json();
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromB64u(vapidPublicKey) });
      const r = await post("/subscribe", { key, subscription: sub.toJSON() });
      if (!r.ok) {
        await sub.unsubscribe(); // keep the browser and the Worker in step
        await render();
        say(r.status === 401 ? "Wrong passphrase." : "The alerts server said no. Try again later.");
        return;
      }
      await render();
      say("Alerts are on. Send a test to check.");
    } catch (e) {
      console.warn("[alerts] turn on:", e);
      if (sub) await sub.unsubscribe().catch(() => {});
      await render();
      say("Couldn't reach the alerts server. Try again.");
    }
  }

  panel.addEventListener("submit", (e) => {
    e.preventDefault();
    turnOn(panel.querySelector("#alerts-key").value);
  });
  panel.addEventListener("click", async (e) => {
    const act = e.target.closest("button[data-act]")?.dataset.act;
    if (!act) return;
    const sub = await currentSub();
    if (!sub) return render();
    try {
      if (act === "test") {
        const r = await post("/test", { endpoint: sub.endpoint });
        say(r.ok ? "Sent. It should arrive in a few seconds." : r.status === 429 ? "One test a minute." : r.status === 404 ? "The server lost this device; turn alerts off and on again." : "The test didn't go through.");
      } else if (act === "off") {
        await post("/unsubscribe", { endpoint: sub.endpoint }).catch(() => {});
        await sub.unsubscribe();
        await render();
        say("Alerts are off for this device.");
      }
    } catch (err) {
      console.warn("[alerts]", err);
      say("Couldn't reach the alerts server. Try again.");
    }
  });

  btn.addEventListener("click", async () => {
    const open = panel.hidden;
    if (open) await render();
    panel.hidden = !open;
    btn.setAttribute("aria-expanded", String(open));
  });

  label(!!(await currentSub()));
}

function fromB64u(s) {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

setupAlerts();
