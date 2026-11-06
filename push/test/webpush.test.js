import { test } from "node:test";
import assert from "node:assert/strict";
import { encrypt, vapidHeader, newVapidKeys, b64u, unb64u } from "../src/webpush.js";

// RFC 8291 §5 / Appendix A: fixed keys and salt, so the output must match byte for byte.
const RFC = {
  plaintext: "When I grow up, I want to be a watermelon",
  as: { publicKey: "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8", privateKey: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw" },
  ua: { p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4", auth: "BTBZMqHH6r4Tts7J_aSIgg" },
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  header: "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  ciphertext: "8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ",
};

test("encrypt matches the RFC 8291 example exactly", async () => {
  const out = await encrypt(RFC.plaintext, RFC.ua, { as: RFC.as, salt: RFC.salt });
  assert.equal(b64u(out.slice(0, 86)), RFC.header);
  assert.equal(b64u(out.slice(86)), RFC.ciphertext);
});

test("random keys and salt still produce a well-formed body", async () => {
  const a = await encrypt("hi", RFC.ua), b = await encrypt("hi", RFC.ua);
  assert.equal(a.length, 86 + 3 + 16); // header + ("hi" + delimiter) + GCM tag
  assert.notEqual(b64u(a), b64u(b));
});

test("VAPID header is a valid ES256 JWT for the push service origin", async () => {
  const keys = await newVapidKeys();
  const now = Date.UTC(2026, 10, 6, 12);
  const h = await vapidHeader("https://web.push.apple.com/QGuQyavXutnMH8Zh", keys, "https://mattrudy13.github.io/hub/", now);
  const [, jwt, k] = h.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.equal(k, keys.publicKey);
  const [head, claims, sig] = jwt.split(".");
  const c = JSON.parse(new TextDecoder().decode(unb64u(claims)));
  assert.equal(c.aud, "https://web.push.apple.com");
  assert.equal(c.exp, now / 1000 + 12 * 3600);
  const pub = await crypto.subtle.importKey("raw", unb64u(keys.publicKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, unb64u(sig), new TextEncoder().encode(`${head}.${claims}`));
  assert.ok(ok);
});
