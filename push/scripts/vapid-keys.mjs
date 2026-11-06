// Makes a VAPID key pair. Prints the public key to stderr (it goes in wrangler.toml's VAPID_PUBLIC) and the
// private one to stdout, so it can be piped straight into the secret without ever showing on screen:
//   node scripts/vapid-keys.mjs | npx wrangler secret put VAPID_PRIVATE
import { newVapidKeys } from "../src/webpush.js";

const { publicKey, privateKey } = await newVapidKeys();
console.error(`VAPID_PUBLIC = "${publicKey}"`);
process.stdout.write(privateKey);
