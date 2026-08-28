import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const skillsRoot = path.join(root, "integrations", "hermes", "skills");

function readYaml(file: string): unknown {
  return YAML.parse(fs.readFileSync(file, "utf8"));
}

function readFrontmatter(file: string): Record<string, unknown> {
  const text = fs.readFileSync(file, "utf8");
  const match = text.match(/^---\n([\s\S]*?)\n---\n/);
  assert(match, `${file} must begin with YAML frontmatter`);
  return YAML.parse(match[1]) as Record<string, unknown>;
}

const skillNames = fs
  .readdirSync(skillsRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.startsWith("kurami-"))
  .map((entry) => entry.name)
  .sort();

assert(skillNames.includes("kurami-daily-briefing"));
assert(skillNames.includes("kurami-ui-preview-language"));

for (const skillName of skillNames) {
  const skillDir = path.join(skillsRoot, skillName);
  const skillFile = path.join(skillDir, "SKILL.md");
  assert(fs.existsSync(skillFile), `${skillName} is missing SKILL.md`);

  const frontmatter = readFrontmatter(skillFile);
  assert.equal(frontmatter.name, skillName, `${skillName} frontmatter name drift`);
  assert.equal(typeof frontmatter.description, "string");
  assert((frontmatter.description as string).length >= 40);
  assert((frontmatter.description as string).length <= 1024);

  const forbidden = fs
    .readdirSync(skillDir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) =>
      name === ".env" ||
      name.endsWith(".db") ||
      name.endsWith(".sqlite") ||
      name.endsWith(".pem") ||
      name.endsWith(".key")
    );
  assert.deepEqual(forbidden, [], `${skillName} contains runtime or secret files`);

  const agentFile = path.join(skillDir, "agents", "openai.yaml");
  if (fs.existsSync(agentFile)) {
    const agent = readYaml(agentFile) as {
      interface?: { display_name?: string; short_description?: string };
      policy?: { allow_implicit_invocation?: boolean };
    };
    assert(agent.interface?.display_name);
    assert(agent.interface?.short_description);
    assert.equal(agent.policy?.allow_implicit_invocation, true);
  }
}

const briefingReferences = [
  "content-contract.md",
  "editorial-policy.md",
  "item-contract.md",
  "provider-composio-gmail.md",
  "provider-composio-google-calendar.md",
  "provider-hermes-weather.md",
  "provider-telegram-user.md",
  "state-and-capabilities.md",
  "topics-and-ranking.md",
];
for (const reference of briefingReferences) {
  assert(
    fs.existsSync(path.join(skillsRoot, "kurami-daily-briefing", "references", reference)),
    `Missing briefing reference ${reference}`,
  );
}

const briefingSkill = fs.readFileSync(
  path.join(skillsRoot, "kurami-daily-briefing", "SKILL.md"),
  "utf8",
);
assert.match(briefingSkill, /\/dist\/briefing\/cli\.js/);
assert.match(briefingSkill, /Hermes `write_file` tool/);
assert.doesNotMatch(briefingSkill, /app\/src\/briefing\/cli\.ts/);

const telegramProfile = fs.readFileSync(
  path.join(
    skillsRoot,
    "kurami-daily-briefing",
    "references",
    "provider-telegram-user.md",
  ),
  "utf8",
);
assert.match(telegramProfile, /min\(captured unread count, settings\.page_size\)/);
assert.match(telegramProfile, /Keep that request size\s+constant across pages/);

const topicsProfile = fs.readFileSync(
  path.join(
    skillsRoot,
    "kurami-daily-briefing",
    "references",
    "topics-and-ranking.md",
  ),
  "utf8",
);
assert.match(topicsProfile, /exact `id` and exact `label`/);
assert.match(topicsProfile, /Never let one unknown candidate abort the\s+edition/);

const config = readYaml(path.join(root, "deploy", "config", "briefing.yaml")) as {
  version: number;
  edition: { timezone: string; daily_retention_days: number };
  safety: {
    production_mutations_enabled: boolean;
    initial_channel_cleanup_confirmed: boolean;
    require_bounded_telegram_commit: boolean;
  };
  capabilities: Record<string, unknown>;
  sources: {
    calendar: { profile: string; enabled: boolean; settings: { calendar: string } };
    mail: { profile: string; enabled: boolean; settings: { query: string; page_size: number } };
    weather: { profile: string; enabled: boolean; settings: { location: string } };
    news: {
      profile: string;
      enabled: boolean;
      settings: { unread_only: boolean; page_size: number; discovery_limit: number };
      channels: Array<{ id: number; key: string }>;
    };
  };
};
assert.equal(config.version, 2);
assert.equal(config.edition.timezone, "Europe/Vilnius");
assert.equal(config.edition.daily_retention_days, 5);
assert.equal(config.safety.production_mutations_enabled, false);
assert.equal(config.safety.initial_channel_cleanup_confirmed, false);
assert.equal(config.safety.require_bounded_telegram_commit, true);
assert.deepEqual(Object.keys(config.capabilities).sort(), ["publisher", "renderer"]);
assert.equal(config.sources.calendar.profile, "composio-google-calendar");
assert.equal(config.sources.calendar.settings.calendar, "primary");
assert.equal(config.sources.mail.profile, "composio-gmail");
assert.equal(config.sources.mail.settings.query, "in:inbox is:unread category:primary");
assert.equal(config.sources.mail.settings.page_size, 100);
assert.equal(config.sources.weather.profile, "hermes-weather");
assert.equal(config.sources.news.profile, "telegram-user");
assert.equal(config.sources.news.settings.unread_only, true);
assert.equal(config.sources.news.settings.discovery_limit, 200);
assert.equal(config.sources.news.channels.length, 15);
assert.equal(new Set(config.sources.news.channels.map((source) => source.id)).size, 15);
assert.equal(new Set(config.sources.news.channels.map((source) => source.key)).size, 15);
const serializedConfig = JSON.stringify(config);
assert(!serializedConfig.includes("GMAIL_FETCH_EMAILS"));
assert(!serializedConfig.includes("GOOGLECALENDAR_EVENTS_LIST"));
assert(!serializedConfig.includes("get_messages"));

const topicSeed = readYaml(path.join(root, "deploy", "config", "briefing-topics.yaml")) as {
  topics: Array<{ id: string; label: string }>;
};
assert(topicSeed.topics.length >= 30 && topicSeed.topics.length <= 50);
assert.equal(new Set(topicSeed.topics.map((topic) => topic.id)).size, topicSeed.topics.length);
for (const topic of topicSeed.topics) {
  assert.match(topic.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  assert(topic.label.length > 0);
}

console.log(`Verified ${skillNames.length} tracked Kurami skills and briefing configuration.`);
