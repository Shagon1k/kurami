// Web Push for the installed Kurami app. Pushes carry no payload: the push service only wakes the service
// worker, which then asks Hub for the newest notice (`/api/push/latest`) through the owner's normal Access
// session. So nothing private passes through Google's or Apple's push servers, and no payload encryption is
// needed: a VAPID signature (ES256, Node's own crypto) is enough. Hub is the only sender, because it is the
// only service allowed to write state/web-push.
import { createPrivateKey, createPublicKey, generateKeyPairSync, randomUUID, sign, type KeyObject } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export type PushSubscriptionRecord = { endpoint: string; lang: "ru" | "en"; createdAt: string };
export type Localized = { ru: string; en: string };
export type PushNotice = { id: string; key: string; title: Localized; body: Localized; url: Localized; at: string };
type Vapid = { publicKey: string; privateKey: KeyObject };
export type PushFetch = (url: string, init: { method: string; headers: Record<string, string>; signal?: AbortSignal }) => Promise<{ status: number }>;

/** Push services Kurami may send to; any other endpoint is refused, so Hub cannot be pointed elsewhere. */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/, /^web\.push\.apple\.com$/];
const MAX_SUBSCRIPTIONS = 10, OUTBOX = 20;
/** VAPID `sub`: a contact for the push service; the public origin, no personal address. */
const SUBJECT = "https://kurami.shagon1k.win";

export const pushPaths = (home: string) => {
  const directory = resolve(home, "state/web-push");
  return { directory, vapid: resolve(directory, "vapid.json"), subscriptions: resolve(directory, "subscriptions.json"), outbox: resolve(directory, "outbox.json"), sent: resolve(directory, "sent.json") };
};

function readJson<T>(path: string, fallback: T): T {
  try { return JSON.parse(readFileSync(path, "utf8")) as T; } catch { return fallback; }
}
function writeJson(path: string, value: unknown): void {
  mkdirSync(resolve(path, ".."), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
}

/** The VAPID key pair, created on first use; the public key is the raw P-256 point in base64url. */
export function vapidKeys(home: string): Vapid {
  const path = pushPaths(home).vapid;
  let stored = readJson<{ privateKey?: string } | null>(path, null);
  if (!stored?.privateKey) {
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    stored = { privateKey: privateKey.export({ format: "pem", type: "pkcs8" }).toString() };
    writeJson(path, stored);
  }
  const privateKey = createPrivateKey(stored.privateKey!);
  const jwk = createPublicKey(privateKey).export({ format: "jwk" }) as { x: string; y: string };
  const point = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]);
  return { publicKey: point.toString("base64url"), privateKey };
}

/** `Authorization: vapid t=<JWT>, k=<public key>` for one push service origin (RFC 8292). */
export function vapidAuthorization(endpoint: string, vapid: Vapid, now = Date.now()): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${part({ typ: "JWT", alg: "ES256" })}.${part({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: SUBJECT })}`;
  const signature = sign("sha256", Buffer.from(unsigned), { key: vapid.privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url");
  return `vapid t=${unsigned}.${signature}, k=${vapid.publicKey}`;
}

export function validPushEndpoint(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 1024) return false;
  try { const url = new URL(value); return url.protocol === "https:" && !url.port && !url.username && PUSH_HOSTS.some(host => host.test(url.hostname)); }
  catch { return false; }
}

export function readSubscriptions(home: string): PushSubscriptionRecord[] {
  const value = readJson<unknown>(pushPaths(home).subscriptions, []);
  return Array.isArray(value) ? value.filter((entry): entry is PushSubscriptionRecord => validPushEndpoint(entry?.endpoint) && (entry.lang === "ru" || entry.lang === "en")) : [];
}

export function subscribe(home: string, endpoint: string, lang: "ru" | "en", now = new Date()): number {
  if (!validPushEndpoint(endpoint)) throw new Error("invalid_endpoint");
  const others = readSubscriptions(home).filter(entry => entry.endpoint !== endpoint);
  const next = [...others, { endpoint, lang, createdAt: now.toISOString() }].slice(-MAX_SUBSCRIPTIONS);
  writeJson(pushPaths(home).subscriptions, next);
  return next.length;
}

export function unsubscribe(home: string, endpoint: string): number {
  const next = readSubscriptions(home).filter(entry => entry.endpoint !== endpoint);
  writeJson(pushPaths(home).subscriptions, next);
  return next.length;
}

/** The newest notices, newest first; the service worker shows the first one it has not shown. */
export function readOutbox(home: string): PushNotice[] {
  const value = readJson<unknown>(pushPaths(home).outbox, []);
  return Array.isArray(value) ? value as PushNotice[] : [];
}

/** What a device sees: the newest notice in the language it subscribed with. Unknown devices get nothing. */
export function latestFor(home: string, endpoint: string): { id: string; title: string; body: string; url: string; tag: string } | null {
  const subscription = readSubscriptions(home).find(entry => entry.endpoint === endpoint), notice = readOutbox(home)[0];
  if (!subscription || !notice) return null;
  const lang = subscription.lang;
  return { id: notice.id, title: notice.title[lang], body: notice.body[lang], url: notice.url[lang], tag: notice.key };
}

/** Queues the notice and wakes every subscribed device; a subscription the service says is gone is dropped. */
export async function sendNotice(home: string, notice: Omit<PushNotice, "id" | "at">, fetchImpl: PushFetch = fetch as unknown as PushFetch, now = new Date()): Promise<{ sent: number; removed: number }> {
  const subscriptions = readSubscriptions(home);
  if (!subscriptions.length) return { sent: 0, removed: 0 };
  const queued: PushNotice = { ...notice, id: randomUUID(), at: now.toISOString() };
  writeJson(pushPaths(home).outbox, [queued, ...readOutbox(home)].slice(0, OUTBOX));
  const vapid = vapidKeys(home);
  let sent = 0;
  const gone: string[] = [];
  await Promise.all(subscriptions.map(async entry => {
    try {
      const response = await fetchImpl(entry.endpoint, { method: "POST", signal: AbortSignal.timeout(10_000),
        headers: { Authorization: vapidAuthorization(entry.endpoint, vapid, now.getTime()), TTL: "86400", Urgency: "normal", "Content-Length": "0" } });
      if (response.status === 404 || response.status === 410) gone.push(entry.endpoint);
      else if (response.status >= 200 && response.status < 300) sent += 1;
    } catch {}
  }));
  if (gone.length) writeJson(pushPaths(home).subscriptions, readSubscriptions(home).filter(entry => !gone.includes(entry.endpoint)));
  return { sent, removed: gone.length };
}

/** Keys already announced, so a notice goes out once per situation; a key not seen for six hours is forgotten, so a problem that returns later is announced again. */
export function readSent(home: string, now = new Date()): Record<string, string> {
  const value = readJson<Record<string, string>>(pushPaths(home).sent, {});
  return Object.fromEntries(Object.entries(value).filter(([, at]) => now.getTime() - Date.parse(at) < 6 * 3_600_000));
}
export function writeSent(home: string, sent: Record<string, string>): void { writeJson(pushPaths(home).sent, sent); }
