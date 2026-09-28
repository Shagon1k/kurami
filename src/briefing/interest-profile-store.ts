import type { DatabaseSync } from "node:sqlite";
import type { TopicDefinition } from "./editorial-validation.ts";
import { loadEdition } from "./edition-store.ts";
import { reactionSourceKeys } from "./interest-profile.ts";
import { briefingAddonEnabled, parseBriefingPayload, type Reaction } from "./model.ts";
import { section } from "./addons/envelopes.ts";

export type TopicProfileRow = {
  topicId: string;
  label: string;
  likes: number;
  dislikes: number;
};

export type TopicPairProfileRow = {
  topicIds: [string, string];
  likes: number;
  dislikes: number;
  reactions: number;
};

export type TopicRegistryRow = TopicDefinition;

function now(): string {
  return new Date().toISOString();
}

function fail(message: string): never {
  throw new Error(message);
}

export function setReaction(
  database: DatabaseSync,
  editionId: string,
  itemId: string,
  reaction: Reaction | "clear",
): void {
  const item = database
    .prepare(`
      SELECT story_fingerprint, topic_ids_json
      FROM edition_items
      WHERE edition_id = ? AND item_id = ? AND item_type = 'story'
    `)
    .get(editionId, itemId) as
    | { story_fingerprint: string | null; topic_ids_json: string }
    | undefined;
  if (!item?.story_fingerprint) fail("Unknown briefing story");
  const edition = loadEdition(database, { id: editionId });
  const payload = edition ? parseBriefingPayload(JSON.parse(edition.payload_json)) : null;
  const story = payload && briefingAddonEnabled(payload, "news")
    ? section(payload, "news").items.find(story => story.id === itemId) : undefined;
  if (!story) fail("Unknown briefing story");
  const context = JSON.stringify({ version: 1, sources: reactionSourceKeys(story) });
  const timestamp = now();
  database.exec("BEGIN IMMEDIATE");
  try {
    database
      .prepare("UPDATE edition_items SET reaction = ?, updated_at = ? WHERE edition_id = ? AND item_id = ?")
      .run(reaction === "clear" ? null : reaction, timestamp, editionId, itemId);
    database
      .prepare(`
        INSERT INTO reaction_events (
          story_fingerprint, topic_ids_json, reaction, recorded_at, context_json
        ) VALUES (?, ?, ?, ?, ?)
      `)
      .run(item.story_fingerprint, item.topic_ids_json, reaction, timestamp, context);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function topicProfile(database: DatabaseSync): TopicProfileRow[] {
  return database
    .prepare(`
      WITH ranked AS (
        SELECT story_fingerprint, topic_ids_json, reaction,
               ROW_NUMBER() OVER (
                 PARTITION BY story_fingerprint ORDER BY event_id DESC
               ) AS position
        FROM reaction_events
      ), current_reactions AS (
        SELECT story_fingerprint, topic_ids_json, reaction
        FROM ranked
        WHERE position = 1 AND reaction != 'clear'
      )
      SELECT topics.value AS topic_id,
             COALESCE(registry.label, topics.value) AS label,
             SUM(CASE WHEN current_reactions.reaction = 'like' THEN 1 ELSE 0 END) AS likes,
             SUM(CASE WHEN current_reactions.reaction = 'dislike' THEN 1 ELSE 0 END) AS dislikes
      FROM current_reactions, json_each(current_reactions.topic_ids_json) AS topics
      LEFT JOIN topic_registry registry ON registry.id = topics.value
      GROUP BY topics.value, registry.label
      ORDER BY likes DESC, dislikes ASC, topics.value ASC
    `)
    .all()
    .map((row) => {
      const value = row as { topic_id: string; label: string; likes: number; dislikes: number };
      return {
        topicId: value.topic_id,
        label: value.label,
        likes: Number(value.likes),
        dislikes: Number(value.dislikes),
      };
    });
}

export function topicPairProfile(database: DatabaseSync): TopicPairProfileRow[] {
  const current = database.prepare(`
    WITH ranked AS (
      SELECT story_fingerprint, topic_ids_json, reaction,
             ROW_NUMBER() OVER (
               PARTITION BY story_fingerprint ORDER BY event_id DESC
             ) AS position
      FROM reaction_events
    )
    SELECT topic_ids_json, reaction
    FROM ranked
    WHERE position = 1 AND reaction != 'clear'
  `).all() as Array<{ topic_ids_json: string; reaction: "like" | "dislike" }>;
  const pairs = new Map<string, { topicIds: [string, string]; likes: number; dislikes: number }>();
  for (const item of current) {
    let topics: string[];
    try {
      const parsed = JSON.parse(item.topic_ids_json) as unknown;
      topics = Array.isArray(parsed)
        ? [...new Set(parsed.filter((value): value is string => typeof value === "string"))].sort()
        : [];
    } catch {
      topics = [];
    }
    for (let left = 0; left < topics.length; left += 1) {
      for (let right = left + 1; right < topics.length; right += 1) {
        const topicIds: [string, string] = [topics[left]!, topics[right]!];
        const key = topicIds.join("+");
        const value = pairs.get(key) ?? { topicIds, likes: 0, dislikes: 0 };
        if (item.reaction === "like") value.likes += 1;
        else value.dislikes += 1;
        pairs.set(key, value);
      }
    }
  }
  return [...pairs.values()]
    .map((value) => ({ ...value, reactions: value.likes + value.dislikes }))
    .filter((value) => value.reactions >= 3)
    .sort((left, right) => right.reactions - left.reactions || left.topicIds.join("+").localeCompare(right.topicIds.join("+")));
}

export function topicRegistry(database: DatabaseSync): TopicRegistryRow[] {
  return database
    .prepare(`
      SELECT id, label, aliases_json, status
      FROM topic_registry
      WHERE status IN ('active', 'proposed')
      ORDER BY status ASC, id ASC
    `)
    .all()
    .map((row) => {
      const value = row as {
        id: string;
        label: string;
        aliases_json: string;
        status: "active" | "proposed";
      };
      let aliases: string[] = [];
      try {
        const parsed = JSON.parse(value.aliases_json) as unknown;
        if (Array.isArray(parsed)) aliases = parsed.filter((item): item is string => typeof item === "string");
      } catch {
        aliases = [];
      }
      return { id: value.id, label: value.label, aliases, status: value.status };
    });
}
