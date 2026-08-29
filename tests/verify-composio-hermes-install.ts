import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parse } from "yaml";
import { installHermesReadSession } from "../src/connectors/composio/hermes-install.ts";

const temporary = await mkdtemp(join(tmpdir(), "kurami-composio-hermes-"));
const configPath = resolve(temporary, "config.yaml");
const runtimeDirectory = resolve(temporary, "runtime");
const dropInPath = resolve(temporary, "systemd/composio-read.conf");
await mkdir(runtimeDirectory);
const original = [
  "# preserve this comment",
  "model: test",
  "mcp_servers:",
  "  composio:",
  "    url: https://example.invalid/broad",
  "    trust: untrusted",
  "",
].join("\n");
await writeFile(configPath, original, { mode: 0o640 });
await chmod(configPath, 0o640);
await writeFile(
  resolve(runtimeDirectory, ".env"),
  [
    "COMPOSIO_API_KEY=must-not-enter-hermes-config",
    "COMPOSIO_SESSION_ID=trs_read_test",
    "COMPOSIO_MCP_URL=https://example.invalid/trs_read_test/mcp",
    "",
  ].join("\n"),
  { mode: 0o600 },
);

const first = await installHermesReadSession({
  hermesConfigPath: configPath,
  runtimeDirectory,
  systemdDropInPath: dropInPath,
});
assert.equal(first.configChanged, true);
assert.equal(first.dropInChanged, true);

const installedText = await readFile(configPath, "utf8");
const installed = parse(installedText) as Record<string, unknown>;
const servers = installed.mcp_servers as Record<string, Record<string, unknown>>;
const readServer = servers["composio-read"]!;
assert.equal(readServer.url, "${COMPOSIO_MCP_URL}");
assert.deepEqual(readServer.headers, { "x-api-key": "${COMPOSIO_API_KEY}" });
assert.equal(readServer.trust, "untrusted");
assert.deepEqual((readServer.tools as Record<string, unknown>).include, [
  "GMAIL_FETCH_EMAILS",
  "GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID",
  "GOOGLECALENDAR_EVENTS_LIST",
]);
assert(!installedText.includes("must-not-enter-hermes-config"));
assert(installedText.includes("# preserve this comment"));
assert.equal((await stat(configPath)).mode & 0o777, 0o640);
assert.equal(await readFile(first.backupPath, "utf8"), original);
assert.equal((await stat(dropInPath)).mode & 0o777, 0o600);
assert((await readFile(dropInPath, "utf8")).includes(resolve(runtimeDirectory, ".env")));

const second = await installHermesReadSession({
  hermesConfigPath: configPath,
  runtimeDirectory,
  systemdDropInPath: dropInPath,
});
assert.equal(second.configChanged, false);
assert.equal(second.dropInChanged, false);

process.stdout.write(`${JSON.stringify({
  ok: true,
  secretNotDuplicated: true,
  envRefsPreserved: true,
  exactReadTools: first.tools.length,
  idempotent: true,
})}\n`);
