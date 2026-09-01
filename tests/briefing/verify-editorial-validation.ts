import assert from "node:assert/strict";
import { resolve } from "node:path";
import { assertEditorialPayload, loadTopicPolicy } from "../../src/briefing/editorial-validation.ts";
import { parseBriefingPayload } from "../../src/briefing/model.ts";

const topicSeed = resolve(import.meta.dirname, "../../deploy/config/briefing-topics.yaml");
const policy = await loadTopicPolicy("/unused", { TOPIC_SEED: topicSeed } as NodeJS.ProcessEnv);

function payload(story: Record<string, unknown>) {
  return parseBriefingPayload({
    schemaVersion: 2,
    edition: {
      id: "daily:2026-09-02",
      type: "daily",
      localDate: "2026-09-02",
      timezone: "Europe/Vilnius",
      generatedAt: "2026-09-02T09:00:00+03:00",
      status: "complete",
      retentionUntil: "2026-09-07T00:00:00Z",
    },
    hero: { title: "Доброе утро, Alex." },
    calendar: { state: "empty", events: [] },
    mail: { state: "empty", items: [] },
    news: {
      state: "ready",
      pageSize: 10,
      mainStoryIds: ["story-1"],
      items: [{
        id: "story-1",
        fingerprint: "story-fingerprint-1",
        headline: "Британские чайки крадут у людей еду на миллионы фунтов",
        summary: "Исследование оценило годовой ущерб от птиц в Великобритании в 171 миллион фунтов.",
        details: ["Авторы отчёта сопоставили число инцидентов и среднюю стоимость потерянных порций."],
        topics: [
          { id: "united-kingdom", label: "United Kingdom" },
          { id: "wildlife", label: "Wildlife" },
          { id: "economy", label: "Economy" },
        ],
        sources: [{ sourceKey: "telegram:onliner", itemIds: ["101"] }],
        ...story,
      }],
    },
    sourceBatches: [{
      sourceKey: "telegram:onliner",
      provider: "telegram",
      providerSourceId: "-1001",
      minItemId: "101",
      maxItemId: "101",
      itemIds: ["101"],
    }],
    dataQuality: { state: "ready" },
  });
}

assert.doesNotThrow(() => assertEditorialPayload(payload({}), policy));

assert.throws(
  () => assertEditorialPayload(payload({
    topics: [
      { id: "belarus", label: "Belarus" },
      { id: "wildlife", label: "Wildlife" },
      { id: "economy", label: "Economy" },
    ],
  }), policy),
  /geography belarus without textual evidence/u,
);

assert.throws(
  () => assertEditorialPayload(payload({
    headline: "В Вильнюсе обсудили судьбу старого жилого квартала",
    summary: "Городской совет Литвы отложил решение по проекту до следующего заседания.",
    topics: [
      { id: "housing", label: "Housing" },
      { id: "lithuania", label: "Lithuania" },
      { id: "public-administration", label: "Public Administration" },
    ],
  }), policy),
  /must refine broad topic housing/u,
);

assert.throws(
  () => assertEditorialPayload(payload({
    summary: "Британские чайки крадут у людей еду на миллионы фунтов, говорится в новом отчёте.",
  }), policy),
  /summary repeats its headline/u,
);

assert.throws(
  () => assertEditorialPayload(payload({
    summary: "Исследование оценило годовой ущерб от птиц в Великобритании в 171 миллион...",
  }), policy),
  /summary looks truncated/u,
);

console.log(JSON.stringify({
  editorialCopyIsIndependent: true,
  clippedCopyIsRejected: true,
  geographyRequiresStoryEvidence: true,
  housingRequiresSpecificSubtype: true,
}));
