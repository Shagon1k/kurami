import type { DatabaseSync } from "node:sqlite";
import {
  addonEnvelopeDigest,
  finalizeEdition,
  loadAddonSnapshot,
  loadEdition,
  upsertAddonSnapshot,
} from "../store.ts";
import {
  cinemaEnvelopePromotable,
  parseCinemaEnvelope,
  type CinemaEnvelope,
} from "./model.ts";

export type CinemaPromotionResult =
  | { status: "promoted"; localDate: string; contentDigest: string; publicationPath?: string }
  | { status: "unchanged"; localDate: string; contentDigest: string }
  | { status: "rejected"; reason: string };

function strictPromotion(database: DatabaseSync, value: unknown): Exclude<CinemaPromotionResult, { status: "rejected" }> {
  const envelope = parseCinemaEnvelope(value);
  if (!cinemaEnvelopePromotable(envelope)) {
    throw new Error("Cinema snapshot does not meet the promotion threshold");
  }

  const digest = addonEnvelopeDigest(envelope);
  const existingRow = loadAddonSnapshot(database, "cinema");
  if (existingRow) {
    const existing = parseCinemaEnvelope(existingRow.envelope);
    if (envelope.data.localDate < existing.data.localDate) {
      throw new Error("Cinema snapshot is older than the current successful snapshot");
    }
    if (envelope.data.localDate === existing.data.localDate) {
      if (digest === existingRow.contentDigest) {
        return { status: "unchanged", localDate: envelope.data.localDate, contentDigest: digest };
      }
      if (Date.parse(envelope.capturedAt) < Date.parse(existing.capturedAt)) {
        throw new Error("Cinema rerun is older than the current same-day snapshot");
      }
    }
  }

  const promoted = upsertAddonSnapshot(database, "cinema", envelope);
  return {
    status: "promoted",
    localDate: envelope.data.localDate,
    contentDigest: promoted.contentDigest,
  };
}

/**
 * Daily calls this non-throwing boundary. Any Cinema validation or promotion
 * failure becomes diagnostics for the add-on run and cannot abort Daily or
 * replace the previous successful Cinema snapshot.
 */
export function promoteCinemaSnapshot(
  database: DatabaseSync,
  value: unknown,
): CinemaPromotionResult {
  try {
    return strictPromotion(database, value);
  } catch (error) {
    return {
      status: "rejected",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export function loadCinemaSnapshot(database: DatabaseSync): CinemaEnvelope | null {
  const row = loadAddonSnapshot(database, "cinema");
  return row ? parseCinemaEnvelope(row.envelope) : null;
}

export function cinemaSnapshotForDaily(
  database: DatabaseSync,
  localDate: string,
): CinemaEnvelope | undefined {
  const snapshot = loadCinemaSnapshot(database);
  return snapshot?.data.localDate === localDate ? snapshot : undefined;
}

export function promoteCinemaEdition(
  database: DatabaseSync,
  editionId: string,
  value: unknown,
): CinemaPromotionResult {
  try {
    const envelope = parseCinemaEnvelope(value);
    if (!cinemaEnvelopePromotable(envelope)) {
      throw new Error("Cinema snapshot does not meet the promotion threshold");
    }
    const edition = loadEdition(database, { id: editionId });
    if (!edition || edition.edition_type !== "cinema") {
      throw new Error("Cinema promotion requires a prepared Cinema edition");
    }
    if (edition.local_date !== envelope.data.localDate) {
      throw new Error("Cinema edition and snapshot dates do not match");
    }
    const existing = loadAddonSnapshot(database, "cinema");
    if (existing) {
      const current = parseCinemaEnvelope(existing.envelope);
      if (envelope.data.localDate < current.data.localDate) {
        throw new Error("Cinema snapshot is older than the current successful snapshot");
      }
      if (envelope.data.localDate === current.data.localDate
        && Date.parse(envelope.capturedAt) < Date.parse(current.capturedAt)) {
        throw new Error("Cinema rerun is older than the current same-day snapshot");
      }
    }
    const finalized = finalizeEdition(database, editionId, [], undefined, {
      addonId: "cinema",
      envelope,
    });
    const promoted = loadAddonSnapshot(database, "cinema");
    if (!promoted) throw new Error("Cinema snapshot was not persisted with its edition");
    return {
      status: "promoted",
      localDate: envelope.data.localDate,
      contentDigest: promoted.contentDigest,
      publicationPath: finalized.publicationPath,
    };
  } catch (error) {
    return {
      status: "rejected",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
