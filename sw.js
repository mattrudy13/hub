// Service worker for the Board's push alerts (alerts.js registers it; the hub-push Worker in push/ sends them).
// No fetch handler on purpose: pages still load from the network exactly as before, nothing is cached.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (e) => {
  let m = {};
  try { m = e.data?.json() ?? {}; } catch { m = { body: e.data?.text() ?? "" }; }
  // iOS revokes push permission from a site that receives a push without showing a notification, so always show one.
  e.waitUntil(self.registration.showNotification(m.title || "Rudy's Board", {
    body: m.body || "",
    icon: "icon-192.png",
    data: { url: m.url || "./" },
  }));
});

// Open the alert's page: a Board page in the home-screen app; an outside link (a GitHub run, another app) in the browser.
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || "./", self.registration.scope).href;
  e.waitUntil((async () => {
    const open = (await self.clients.matchAll({ type: "window", includeUncontrolled: true })).find((w) => w.url === url);
    return open ? open.focus() : self.clients.openWindow(url);
  })());
});
