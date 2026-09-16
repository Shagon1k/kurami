import { parseBriefingPayload, type BriefingPayload } from "../model.ts";
import { parseCinemaEnvelope } from "./model.ts";

export function cinemaEnvelopeToBriefingPayload(value: unknown): BriefingPayload {
  const envelope = parseCinemaEnvelope(value);
  const retentionUntil = new Date(
    Date.parse(`${envelope.data.localDate}T00:00:00Z`) + 370 * 86_400_000,
  ).toISOString();
  const state = envelope.state === "ready" ? "ready" : "partial";
  return parseBriefingPayload({
    schemaVersion: 1,
    formatVersion: 3,
    edition: {
      id: `cinema:${envelope.data.localDate}`,
      type: "cinema",
      localDate: envelope.data.localDate,
      timezone: envelope.data.timezone,
      generatedAt: envelope.capturedAt,
      status: envelope.state === "ready" ? "complete" : "partial",
      retentionUntil,
    },
    hero: {
      title: "Кино за неделю",
      subtitle: "Прокат, свежие трейлеры, премьеры и то, что стоило заметить.",
    },
    dataQuality: { state, summary: envelope.data.quality.summary },
    addons: { cinema: envelope },
  });
}
