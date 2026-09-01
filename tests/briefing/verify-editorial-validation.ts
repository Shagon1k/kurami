import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { assertEditorialPayload, loadTopicPolicy } from "../../src/briefing/editorial-validation.ts";
import { parseBriefingPayload } from "../../src/briefing/model.ts";
import { briefingPaths, openBriefingDatabase, preparePreview, topicRegistry } from "../../src/briefing/store.ts";
import { renderBriefingPage } from "../../src/briefing/ui/render-page.ts";

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

const proposedPayload = payload({
  topics: [
    { id: "united-kingdom", label: "United Kingdom" },
    { id: "wildlife", label: "Wildlife" },
    {
      id: "food-theft",
      label: "Food Theft",
      status: "proposed",
      aliases: ["stolen food", "кража еды"],
    },
  ],
});
assert.doesNotThrow(() => assertEditorialPayload(proposedPayload, policy));
assert.throws(
  () => assertEditorialPayload(payload({
    topics: [
      { id: "wildlife", label: "Wildlife" },
      {
        id: "britain-news",
        label: "Britain News",
        status: "proposed",
        aliases: ["United Kingdom"],
      },
    ],
  }), policy),
  /duplicates united-kingdom/u,
);

const home = await mkdtemp(resolve(tmpdir(), "kurami-editorial-topics-"));
const paths = briefingPaths({
  KURAMI_HOME: home,
  BRIEFING_MIGRATIONS_DIR: resolve(import.meta.dirname, "../../migrations/briefing"),
} as NodeJS.ProcessEnv);
await preparePreview(proposedPayload, renderBriefingPage(proposedPayload), paths);
const database = openBriefingDatabase(paths);
try {
  assert.deepEqual(topicRegistry(database).find((topic) => topic.id === "food-theft"), {
    id: "food-theft",
    label: "Food Theft",
    aliases: ["stolen food", "кража еды"],
    status: "proposed",
  });
} finally {
  database.close();
}

console.log(JSON.stringify({
  editorialCopyIsIndependent: true,
  clippedCopyIsRejected: true,
  geographyRequiresStoryEvidence: true,
  housingRequiresSpecificSubtype: true,
  aiMayProposeAndUseNewTopic: true,
  proposedTopicPersistsInPool: true,
}));
