import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  accountPinEnvironmentName,
  buildSessionSyncPlan,
  parseDesiredState,
  parseEnvFile,
  redactComposioText,
  resolveRuntime,
  runSessionSync,
  type ComposioSessionApi,
  type ConnectedAccount,
  type SessionPatch,
  type SessionSnapshot,
} from "../src/connectors/composio/session-sync.ts";

const desiredYaml = `
version: 1
toolkits:
  - gmail
  - googlecalendar
  - google_analytics
disable_tags:
  - destructiveHint
manage_connections: false
workbench: false
multi_account: true
require_explicit_account_selection: true
`;

const desired = parseDesiredState(desiredYaml);
assert.deepEqual(desired.toolkits, ["gmail", "google_analytics", "googlecalendar"]);
assert.deepEqual(
  parseEnvFile("export COMPOSIO_API_KEY='safe-test-key'\nCOMPOSIO_SESSION_ID=trs_test\n"),
  { COMPOSIO_API_KEY: "safe-test-key", COMPOSIO_SESSION_ID: "trs_test" },
);
assert.equal(accountPinEnvironmentName("google_analytics"), "COMPOSIO_ACCOUNT_GOOGLE_ANALYTICS");
assert.equal(
  resolveRuntime({
    COMPOSIO_API_KEY: "safe-test-key",
    COMPOSIO_MCP_URL: "https://app.composio.dev/tool_router/v3/trs_test/mcp",
  }).sessionId,
  "trs_test",
);

const baseSession: SessionSnapshot = {
  session_id: "trs_test",
  mcp: {
    type: "http",
    url: "https://app.composio.dev/tool_router/v3/trs_test/mcp",
  },
  tool_router_tools: [
    "COMPOSIO_GET_TOOL_SCHEMAS",
    "COMPOSIO_MULTI_EXECUTE_TOOL",
    "COMPOSIO_SEARCH_TOOLS",
  ],
  config_version: 7,
  config: {
    user_id: "kurami",
    toolkits: { enabled: ["gmail", "googlecalendar"] },
    connected_accounts: {
      gmail: ["ca_gmail"],
      googlecalendar: ["ca_calendar"],
    },
    tags: { disabled: ["destructiveHint"] },
    manage_connections: { enabled: false },
    workbench: { enable: false, proxy_execution_enabled: false },
    multi_account: { enable: true, require_explicit_selection: true },
  },
};

const accounts: ConnectedAccount[] = [
  {
    id: "ca_gmail",
    toolkit: { slug: "gmail" },
    user_id: "kurami",
    status: "ACTIVE",
  },
  {
    id: "ca_calendar",
    toolkit: { slug: "googlecalendar" },
    user_id: "kurami",
    status: "ACTIVE",
  },
  {
    id: "ca_analytics",
    toolkit: { slug: "google_analytics" },
    user_id: "kurami",
    status: "ACTIVE",
  },
];

const plan = buildSessionSyncPlan(desired, baseSession, accounts);
assert(plan.diff.some((entry) => entry.kind === "add" && entry.after === "google_analytics"));
assert(plan.diff.some((entry) => entry.field === "accounts.google_analytics"));
assert.deepEqual(plan.patch.connected_accounts.google_analytics, ["ca_analytics"]);
assert(!JSON.stringify(plan.diff).includes("ca_analytics"));

const workbenchAliasPreserved = buildSessionSyncPlan(
  desired,
  {
    ...baseSession,
    config: {
      ...baseSession.config,
      workbench: { enable: false, proxy_execution_enabled: true },
    },
  },
  accounts,
);
assert.equal(workbenchAliasPreserved.patch.workbench.proxy_execution_enabled, true);

const secondGmail = {
  ...accounts[0]!,
  id: "ca_gmail_second",
  updated_at: "2026-08-28T10:00:00Z",
};
const preserved = buildSessionSyncPlan(desired, baseSession, [...accounts, secondGmail]);
assert.deepEqual(preserved.patch.connected_accounts.gmail, ["ca_gmail"]);
assert(preserved.warnings[0]?.includes("COMPOSIO_ACCOUNT_GMAIL"));
assert(!preserved.warnings[0]?.includes("ca_gmail"));

const noCurrentAnalyticsPin: SessionSnapshot = {
  ...baseSession,
  config: {
    ...baseSession.config,
    toolkits: { enabled: ["gmail", "googlecalendar"] },
  },
};
assert.throws(
  () => buildSessionSyncPlan(
    desired,
    noCurrentAnalyticsPin,
    [...accounts, { ...accounts[2]!, id: "ca_analytics_second" }],
  ),
  /COMPOSIO_ACCOUNT_GOOGLE_ANALYTICS/u,
);

const redacted = redactComposioText(
  "x-api-key: secret ca_private trs_private https://app.composio.dev/tool_router/v3/trs_private/mcp",
);
assert(!redacted.includes("secret"));
assert(!redacted.includes("ca_private"));
assert(!redacted.includes("trs_private"));

class FakeApi implements ComposioSessionApi {
  patchCalls = 0;
  observedConfigVersion: number | undefined;
  session = structuredClone(baseSession);

  async getSession(): Promise<SessionSnapshot> {
    return structuredClone(this.session);
  }

  async listConnectedAccounts(): Promise<ConnectedAccount[]> {
    return structuredClone(accounts);
  }

  async patchSession(
    _sessionId: string,
    patch: SessionPatch,
    configVersion?: number,
  ): Promise<SessionSnapshot> {
    this.patchCalls += 1;
    this.observedConfigVersion = configVersion;
    this.session = {
      ...this.session,
      config_version: (this.session.config_version ?? 0) + 1,
      config: { ...this.session.config, ...structuredClone(patch) },
    };
    return structuredClone(this.session);
  }
}

const temporary = await mkdtemp(join(tmpdir(), "kurami-composio-session-"));
try {
  const configPath = resolve(temporary, "composio-session.yaml");
  const runtimeDirectory = resolve(temporary, "runtime");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(runtimeDirectory));
  await writeFile(configPath, desiredYaml);
  await writeFile(
    resolve(runtimeDirectory, ".env"),
    [
      "COMPOSIO_API_KEY=safe-test-key",
      "COMPOSIO_SESSION_ID=trs_test",
      "COMPOSIO_MCP_URL=https://app.composio.dev/tool_router/v3/trs_test/mcp",
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
  await writeFile(
    resolve(runtimeDirectory, "mcp-meta.json"),
    `${JSON.stringify({ headers: { "x-api-key": "\${COMPOSIO_API_KEY}" } })}\n`,
    { mode: 0o600 },
  );

  const checkApi = new FakeApi();
  const check = await runSessionSync({
    apply: false,
    desiredStatePath: configPath,
    runtimeDirectory,
    api: checkApi,
  });
  assert.equal(check.changed, true);
  assert.equal(checkApi.patchCalls, 0);

  const applyApi = new FakeApi();
  const applied = await runSessionSync({
    apply: true,
    desiredStatePath: configPath,
    runtimeDirectory,
    api: applyApi,
  });
  assert.equal(applied.applied, true);
  assert.equal(applyApi.patchCalls, 1);
  assert.equal(applyApi.observedConfigVersion, 7);
  const meta = JSON.parse(
    await readFile(resolve(runtimeDirectory, "mcp-meta.json"), "utf8"),
  ) as Record<string, unknown>;
  assert(meta.session_sync);
  assert(!JSON.stringify(meta.session_sync).includes("ca_"));
  assert.equal((await stat(resolve(runtimeDirectory, "mcp-meta.json"))).mode & 0o777, 0o600);
} finally {
  await rm(temporary, { recursive: true, force: true });
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  dryRunDefault: true,
  explicitApply: true,
  accountIdsRedacted: true,
  persistentSessionVerified: true,
  atomicMetaMode: "0600",
})}\n`);
