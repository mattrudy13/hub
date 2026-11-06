// Web Push sending on WebCrypto only: RFC 8291 payload encryption (aes128gcm) and RFC 8292 VAPID signing.
// Written here instead of pulled from npm because it's small, well specified, and RFC 8291 publishes an
// exact test vector (push/test/webpush.test.js checks it), so a hand-rolled version can be proven right.
// Runs the same on Cloudflare Workers and Node 20+ (both have crypto.subtle).

const subtle = crypto.subtle;
const enc = new TextEncoder();

export function b64u(bytes) {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function unb64u(str) {
  const s = atob(str.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (str.length % 4)) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) { out.set(p, i); i += p.length; }
  return out;
};

async function hmac(key, data) {
  const k = await subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await subtle.sign("HMAC", k, data));
}
// HKDF with a single 32-byte output block, which is all Web Push needs (RFC 8291 §3.3–3.4).
const hkdf = async (salt, ikm, info, len) => (await hmac(await hmac(salt, ikm), concat(info, Uint8Array.of(1)))).slice(0, len);

// A P-256 private key from its raw d and its 65-byte uncompressed public key (WebCrypto has no raw private import).
function privateJwk(d, pub) {
  return { kty: "EC", crv: "P-256", d, x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)), ext: true };
}

// RFC 8291: encrypt `plaintext` for one subscription. `as` (server ECDH keys) and `salt` are only passed by
// the test; normally both are random per message.
export async function encrypt(plaintext, { p256dh, auth }, { as, salt } = {}) {
  const uaPublic = unb64u(p256dh), authSecret = unb64u(auth);
  let asPrivate, asPublic;
  if (as) {
    asPublic = unb64u(as.publicKey);
    asPrivate = await subtle.importKey("jwk", privateJwk(as.privateKey, asPublic), { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  } else {
    const pair = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
    asPrivate = pair.privateKey;
    asPublic = new Uint8Array(await subtle.exportKey("raw", pair.publicKey));
  }
  salt = salt ? unb64u(salt) : crypto.getRandomValues(new Uint8Array(16));

  const uaKey = await subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdhSecret = new Uint8Array(await subtle.deriveBits({ name: "ECDH", public: uaKey }, asPrivate, 256));
  const keyInfo = concat(enc.encode("WebPush: info\0"), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);

  // One record: the plaintext plus the 0x02 "last record" delimiter, no padding.
  const record = concat(typeof plaintext === "string" ? enc.encode(plaintext) : plaintext, Uint8Array.of(2));
  const aes = await subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ciphertext = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv: nonce }, aes, record));

  // Header: salt (16) | record size 4096 (uint32) | key id length (1) | key id = server public key (65).
  const header = concat(salt, Uint8Array.of(0, 0, 0x10, 0), Uint8Array.of(asPublic.length), asPublic);
  return concat(header, ciphertext);
}

// RFC 8292: the VAPID Authorization header for one push service origin. `vapid` = { publicKey, privateKey }
// as base64url (65-byte public key, 32-byte d). `subject` is a contact URL the push service can use.
export async function vapidHeader(endpoint, vapid, subject, now = Date.now()) {
  const pub = unb64u(vapid.publicKey);
  const key = await subtle.importKey("jwk", privateJwk(vapid.privateKey, pub), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const head = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  // 12 hours: well under the 24 h maximum push services accept.
  const claims = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })));
  // WebCrypto's ECDSA signature is already the raw r||s form JWS wants.
  const sig = new Uint8Array(await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${head}.${claims}`)));
  return `vapid t=${head}.${claims}.${b64u(sig)}, k=${vapid.publicKey}`;
}

// Send one message. Returns the push service's HTTP status: 201 = accepted; 404/410 = the subscription is gone.
export async function sendPush(subscription, message, vapid, subject, { ttl = 6 * 3600, urgency = "normal" } = {}) {
  const body = await encrypt(JSON.stringify(message), subscription.keys);
  const res = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      Authorization: await vapidHeader(subscription.endpoint, vapid, subject),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(ttl),
      Urgency: urgency,
    },
    body,
  });
  return res.status;
}

// A new VAPID key pair, as base64url strings (scripts/vapid-keys.mjs prints the public one, pipes the private one).
export async function newVapidKeys() {
  const pair = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
  const jwk = await subtle.exportKey("jwk", pair.privateKey);
  return { publicKey: b64u(await subtle.exportKey("raw", pair.publicKey)), privateKey: jwk.d };
}
