// Web Push: the VAPID header verifies against the published key, only known push services are accepted,
// a gone subscription is dropped, each device reads the notice in its own language, and the monitor's
// first pass and passes without devices only remember, so nothing old is ever pushed.
import assert from "node:assert/strict";
import { createPublicKey, verify } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { latestFor, readSubscriptions, sendNotice, subscribe, unsubscribe, validPushEndpoint, vapidAuthorization, vapidKeys, type PushFetch } from "../../src/hub/push/web-push.ts";
import { pushPass } from "../../src/hub/push/monitor.ts";
import { syntheticHubSnapshot } from "../../src/ui-library/testing/fixtures.ts";
import { createHubServer } from "../../src/hub/server.ts";
import type { AddressInfo } from "node:net";

const home = mkdtempSync(join(tmpdir(), "kurami-push-"));
const phone = "https://fcm.googleapis.com/fcm/send/device-1", laptop = "https://updates.push.services.mozilla.com/wpush/v2/device-2";
try {
  // VAPID: the JWT is signed by the key whose public half the browser subscribed with.
  const keys = vapidKeys(home);
  assert.equal(vapidKeys(home).publicKey, keys.publicKey, "the key pair is created once");
  const header = vapidAuthorization(phone, keys, Date.parse("2026-10-07T05:00:00Z"));
  const [, jwt, publicKey] = /^vapid t=([^,]+), k=(.+)$/.exec(header)!;
  assert.equal(publicKey, keys.publicKey);
  const [head, claims, signature] = jwt!.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(claims!, "base64url").toString()), { aud: "https://fcm.googleapis.com", exp: Date.parse("2026-10-07T17:00:00Z") / 1000, sub: "https://kurami.shagon1k.win" });
  const point = Buffer.from(keys.publicKey, "base64url");
  const jwk = { kty: "EC", crv: "P-256", x: point.subarray(1, 33).toString("base64url"), y: point.subarray(33).toString("base64url") };
  assert.ok(verify("sha256", Buffer.from(`${head}.${claims}`), { key: createPublicKey({ key: jwk, format: "jwk" }), dsaEncoding: "ieee-p1363" }, Buffer.from(signature!, "base64url")));

  // Endpoints: only push services, https, no ports or credentials.
  for (const bad of ["http://fcm.googleapis.com/x", "https://example.org/push", "https://fcm.googleapis.com:8443/x", "https://user@fcm.googleapis.com/x", 7]) assert.equal(validPushEndpoint(bad), false);
  assert.throws(() => subscribe(home, "https://169.254.169.254/latest", "ru"), /invalid_endpoint/);

  // Monitor before any device: remembers, sends nothing.
  const calls: string[] = [];
  const fetchImpl: PushFetch = async (url, init) => { calls.push(`${init.method} ${url}`); return { status: url === laptop ? 410 : 201 }; };
  const snapshot = syntheticHubSnapshot();
  assert.deepEqual(await pushPass(home, snapshot, { fetchImpl }), [], "first pass: baseline only");
  subscribe(home, phone, "ru"); subscribe(home, laptop, "en");
  assert.deepEqual(await pushPass(home, snapshot, { fetchImpl }), [], "nothing new since the baseline");
  assert.deepEqual(calls, []);

  // A new owner problem goes out once; the laptop's gone subscription is dropped.
  const changed = syntheticHubSnapshot();
  changed.operations!.alerts.push({ id: "new", severity: "warning", code: "owner_input", subject: "TailorTales", title: "Choose a cover", project: "tailortales", itemId: "item-9", href: "https://github.com/Shagon1k/TailorTales/pull/9", actor: "owner", next: "reply" } as never);
  const announced = await pushPass(home, changed, { fetchImpl });
  assert.equal(announced.length, 1);
  assert.deepEqual(calls.sort(), [`POST ${phone}`, `POST ${laptop}`].sort());
  assert.deepEqual(readSubscriptions(home).map(entry => entry.endpoint), [phone], "410 drops the subscription");
  assert.deepEqual(await pushPass(home, changed, { fetchImpl }), [], "the same situation is not announced twice");

  // Each device reads the notice in its language; an unknown endpoint reads nothing.
  const notice = latestFor(home, phone)!;
  assert.equal(notice.title, "Kurami ждёт тебя");
  assert.match(notice.body, /TailorTales · Choose a cover\nНужен ответ/);
  assert.equal(notice.url, "https://kurami.shagon1k.win/ru/projects/?project=tailortales&item=item-9");
  assert.equal(latestFor(home, laptop), null);

  // No devices: sendNotice does nothing.
  unsubscribe(home, phone);
  assert.deepEqual(await sendNotice(home, { key: "x", title: { ru: "a", en: "a" }, body: { ru: "", en: "" }, url: { ru: "/", en: "/" } }, fetchImpl), { sent: 0, removed: 0 });
  // HTTP: owner identity for everything; subscribing also needs the exact origin and the CSRF pair.
  let owner = true;
  const server = createHubServer({ snapshot: syntheticHubSnapshot, authorize: async () => owner ? "owner" : null, home, controlOrigin: "https://hub.test" });
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`, token = "a".repeat(43);
  const post = (headers: Record<string, string>) => fetch(`${base}/api/push`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ action: "subscribe", endpoint: phone, lang: "en" }) });
  try {
    assert.equal(((await (await fetch(`${base}/api/push/key`)).json()) as { publicKey: string }).publicKey, keys.publicKey);
    assert.equal((await post({ origin: "https://hub.test" })).status, 403, "no CSRF pair");
    assert.equal((await post({ origin: "https://evil.test", cookie: `__Host-kurami-control=${token}`, "x-hub-control-token": token })).status, 403, "wrong origin");
    assert.equal((await post({ origin: "https://hub.test", cookie: `__Host-kurami-control=${token}`, "x-hub-control-token": token })).status, 200);
    assert.deepEqual(readSubscriptions(home).map(entry => [entry.endpoint, entry.lang]), [[phone, "en"]]);
    owner = false;
    assert.equal((await fetch(`${base}/api/push/latest?endpoint=${encodeURIComponent(phone)}`)).status, 403, "no identity, no notice");
  } finally { server.close(); }
  console.log(JSON.stringify({ ok: true, push: "VAPID signature, endpoint allowlist, baseline, once per situation, 410 cleanup, per-device language" }));
} finally { rmSync(home, { recursive: true, force: true }); }
