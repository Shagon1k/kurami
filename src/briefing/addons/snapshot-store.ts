import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { parseBriefingAddonEnvelope, type BriefingAddonEnvelope } from "../model.ts";

export type AddonSnapshotRow = {
  addonId: string;
  envelope: BriefingAddonEnvelope;
  contentDigest: string;
  updatedAt: string;
};

const ADDON_ID = /^[a-z][a-z0-9-]{0,63}$/u;

export function checkedAddonId(addonId: string): string {
  if (!ADDON_ID.test(addonId)) throw new Error(`Invalid briefing add-on ID ${addonId || "<empty>"}`);
  return addonId;
}

export function canonicalJson(value: unknown): string {
  const seen = new Set<object>();
  const normalize = (current: unknown, label: string): unknown => {
    if (current === null || typeof current === "string" || typeof current === "boolean") return current;
    if (typeof current === "number") {
      if (!Number.isFinite(current)) throw new Error(`${label} contains a non-finite number`);
      return current;
    }
    if (Array.isArray(current)) return current.map((item, index) => normalize(item, `${label}[${index}]`));
    if (typeof current !== "object") throw new Error(`${label} is not JSON-serializable`);
    if (seen.has(current)) throw new Error(`${label} contains a circular reference`);
    const prototype = Object.getPrototypeOf(current);
    if (prototype !== Object.prototype && prototype !== null) throw new Error(`${label} must contain plain JSON objects`);
    seen.add(current);
    const normalized = Object.fromEntries(Object.keys(current as Record<string, unknown>)
      .sort()
      .map((key) => [key, normalize((current as Record<string, unknown>)[key], `${label}.${key}`)]));
    seen.delete(current);
    return normalized;
  };
  return JSON.stringify(normalize(value, "add-on snapshot"));
}

export function addonEnvelopeDigest(envelopeValue: BriefingAddonEnvelope): string {
  const envelope = parseBriefingAddonEnvelope(envelopeValue, "add-on digest");
  return createHash("sha256").update(canonicalJson(envelope)).digest("hex");
}

export function upsertAddonSnapshot(
  database: DatabaseSync,
  addonIdValue: string,
  envelopeValue: BriefingAddonEnvelope,
): AddonSnapshotRow {
  const addonId = checkedAddonId(addonIdValue);
  const envelope = parseBriefingAddonEnvelope(envelopeValue, `snapshot.${addonId}`);
  const payloadJson = canonicalJson(envelope.data);
  const contentDigest = addonEnvelopeDigest(envelope);
  const updatedAt = new Date().toISOString();
  database.prepare(`
    INSERT INTO addon_snapshots (
      addon_id, schema_version, state, payload_json,
      content_digest, captured_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(addon_id) DO UPDATE SET
      schema_version = excluded.schema_version,
      state = excluded.state,
      payload_json = excluded.payload_json,
      content_digest = excluded.content_digest,
      captured_at = excluded.captured_at,
      updated_at = excluded.updated_at
  `).run(
    addonId,
    envelope.version,
    envelope.state,
    payloadJson,
    contentDigest,
    envelope.capturedAt,
    updatedAt,
  );
  return { addonId, envelope, contentDigest, updatedAt };
}

type StoredAddonSnapshot = {
  addon_id: string;
  schema_version: number;
  state: string;
  payload_json: string;
  content_digest: string;
  captured_at: string;
  updated_at: string;
};

function parsedAddonSnapshot(row: StoredAddonSnapshot): AddonSnapshotRow {
  let data: unknown;
  try {
    data = JSON.parse(row.payload_json) as unknown;
  } catch {
    throw new Error(`Stored add-on snapshot ${row.addon_id} contains invalid JSON`);
  }
  return {
    addonId: checkedAddonId(row.addon_id),
    envelope: parseBriefingAddonEnvelope({
      version: row.schema_version,
      state: row.state,
      capturedAt: row.captured_at,
      data,
    }, `snapshot.${row.addon_id}`),
    contentDigest: row.content_digest,
    updatedAt: row.updated_at,
  };
}

export function loadAddonSnapshot(
  database: DatabaseSync,
  addonIdValue: string,
): AddonSnapshotRow | null {
  const addonId = checkedAddonId(addonIdValue);
  const row = database.prepare(`
    SELECT addon_id, schema_version, state, payload_json,
           content_digest, captured_at, updated_at
    FROM addon_snapshots WHERE addon_id = ?
  `).get(addonId) as StoredAddonSnapshot | undefined;
  return row ? parsedAddonSnapshot(row) : null;
}

export function listAddonSnapshots(database: DatabaseSync): AddonSnapshotRow[] {
  return (database.prepare(`
    SELECT addon_id, schema_version, state, payload_json,
           content_digest, captured_at, updated_at
    FROM addon_snapshots ORDER BY addon_id
  `).all() as StoredAddonSnapshot[]).map(parsedAddonSnapshot);
}
