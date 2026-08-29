import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parse as parseYaml } from "yaml";

export type ComposioDesiredState = {
  version: 1 | 2;
  toolkits: string[];
  enableTags: string[];
  disableTags: string[];
  manageConnections: boolean;
  workbench: boolean;
  multiAccount: boolean;
  requireExplicitAccountSelection: boolean;
};

export type ComposioRuntime = {
  apiKey: string;
  sessionId: string;
  mcpUrl?: string;
  accountPins: Record<string, string[]>;
};

export type ConnectedAccount = {
  id: string;
  toolkit: { slug: string };
  user_id: string;
  status: string;
  is_disabled?: boolean;
  updated_at?: string;
};

export type SessionSnapshot = {
  session_id: string;
  mcp?: { type?: string; url?: string };
  tool_router_tools?: string[];
  config_version?: number;
  config: Record<string, unknown>;
};

export type SessionPatch = {
  toolkits: { enabled: string[] };
  connected_accounts: Record<string, string[]>;
  tags: { enabled: string[]; disabled: string[] };
  manage_connections: Record<string, unknown> & { enabled: boolean };
  workbench: Record<string, unknown> & {
    enable: boolean;
    proxy_execution_enabled: boolean;
  };
  multi_account: Record<string, unknown> & {
    enable: boolean;
    require_explicit_selection: boolean;
  };
};

export type SessionDiffEntry = {
  kind: "add" | "remove" | "change";
  field: string;
  before?: string | number | boolean;
  after?: string | number | boolean;
};

export type SessionSyncPlan = {
  patch: SessionPatch;
  diff: SessionDiffEntry[];
  activeAccountCounts: Record<string, number>;
  selectedAccountCounts: Record<string, number>;
  warnings: string[];
};

export interface ComposioSessionApi {
  getSession(sessionId: string): Promise<SessionSnapshot>;
  listConnectedAccounts(userId: string): Promise<ConnectedAccount[]>;
  createSession(config: SessionPatch & { user_id: string }): Promise<SessionSnapshot>;
  patchSession(
    sessionId: string,
    patch: SessionPatch,
    configVersion?: number,
  ): Promise<SessionSnapshot>;
}

type JsonRecord = Record<string, unknown>;

function fail(message: string): never {
  throw new Error(message);
}

function record(value: unknown): JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function booleanField(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") fail(`${name} must be a boolean`);
  return value;
}

function readToolkitList(value: JsonRecord): string[] {
  return uniqueSorted(stringArray(value.enabled ?? value.enable));
}

function readDisabledTags(value: JsonRecord): string[] {
  return uniqueSorted(stringArray(value.disabled ?? value.disable));
}

function readEnabledTags(value: JsonRecord): string[] {
  return uniqueSorted(stringArray(value.enabled ?? value.enable));
}

function readAccountMap(value: unknown): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const [toolkit, raw] of Object.entries(record(value))) {
    const values = typeof raw === "string" ? [raw] : stringArray(raw);
    if (values.length > 0) result[toolkit] = values;
  }
  return result;
}

export function parseDesiredState(input: string): ComposioDesiredState {
  const raw = record(parseYaml(input));
  if (raw.version !== 1 && raw.version !== 2) {
    fail("Composio desired state must use version: 1 or 2");
  }
  const toolkits = uniqueSorted(stringArray(raw.toolkits));
  if (toolkits.length === 0) fail("Composio desired state has no toolkits");
  for (const toolkit of toolkits) {
    if (!/^[a-z0-9_]+$/u.test(toolkit)) {
      fail(`Invalid Composio toolkit slug: ${toolkit}`);
    }
  }
  return {
    version: raw.version,
    toolkits,
    enableTags: raw.version === 2 ? uniqueSorted(stringArray(raw.enable_tags)) : [],
    disableTags: uniqueSorted(stringArray(raw.disable_tags)),
    manageConnections: booleanField(raw.manage_connections, "manage_connections"),
    workbench: booleanField(raw.workbench, "workbench"),
    multiAccount: booleanField(raw.multi_account, "multi_account"),
    requireExplicitAccountSelection: booleanField(
      raw.require_explicit_account_selection,
      "require_explicit_account_selection",
    ),
  };
}

export async function loadDesiredState(path: string): Promise<ComposioDesiredState> {
  return parseDesiredState(await readFile(path, "utf8"));
}

export function parseEnvFile(input: string): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const rawLine of input.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Z][A-Z0-9_]*)=(.*)$/u.exec(line);
    if (!match) fail("Invalid line in Composio runtime .env");
    let value = match[2]!.trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    environment[match[1]!] = value;
  }
  return environment;
}

export function accountPinEnvironmentName(toolkit: string): string {
  return `COMPOSIO_ACCOUNT_${toolkit.toUpperCase().replace(/[^A-Z0-9]+/gu, "_")}`;
}

export function resolveRuntime(environment: Record<string, string>): ComposioRuntime {
  const apiKey = environment.COMPOSIO_API_KEY?.trim();
  if (!apiKey) fail("COMPOSIO_API_KEY is missing from the runtime .env");
  const mcpUrl = environment.COMPOSIO_MCP_URL?.trim();
  const sessionId = environment.COMPOSIO_SESSION_ID?.trim() ??
    /(?:^|\/)(trs_[A-Za-z0-9_-]+)(?:\/|$)/u.exec(mcpUrl ?? "")?.[1];
  if (!sessionId) {
    fail("COMPOSIO_SESSION_ID is missing and could not be derived from COMPOSIO_MCP_URL");
  }
  const accountPins: Record<string, string[]> = {};
  for (const [name, value] of Object.entries(environment)) {
    if (!name.startsWith("COMPOSIO_ACCOUNT_")) continue;
    accountPins[name] = uniqueSorted(value.split(","));
  }
  return { apiKey, sessionId, mcpUrl, accountPins };
}

export async function loadRuntime(path: string): Promise<ComposioRuntime> {
  return resolveRuntime(parseEnvFile(await readFile(path, "utf8")));
}

function selectedAccountsForToolkit(
  toolkit: string,
  accounts: ConnectedAccount[],
  currentPins: Record<string, string[]>,
  runtimePins: Record<string, string[]>,
  desired: ComposioDesiredState,
): { ids: string[]; activeCount: number; warning?: string } {
  const active = accounts
    .filter((account) =>
      account.toolkit.slug === toolkit &&
      account.status === "ACTIVE" &&
      account.is_disabled !== true
    )
    .sort((left, right) =>
      String(right.updated_at ?? "").localeCompare(String(left.updated_at ?? ""))
    );
  if (active.length === 0) {
    fail(`Toolkit ${toolkit} has no active connected account`);
  }
  const activeIds = new Set(active.map((account) => account.id));
  const environmentName = accountPinEnvironmentName(toolkit);
  const explicit = runtimePins[environmentName] ?? [];
  if (explicit.length > 0) {
    if (explicit.some((id) => !activeIds.has(id))) {
      fail(`${environmentName} does not reference an active ${toolkit} account`);
    }
    if (!desired.multiAccount && explicit.length > 1) {
      fail(`${environmentName} selects multiple accounts while multi_account is disabled`);
    }
    return { ids: explicit, activeCount: active.length };
  }
  const existing = uniqueSorted(
    (currentPins[toolkit] ?? []).filter((id) => activeIds.has(id)),
  );
  if (existing.length > 0) {
    if (!desired.multiAccount && existing.length > 1) {
      fail(`Session pins multiple ${toolkit} accounts while multi_account is disabled`);
    }
    return {
      ids: existing,
      activeCount: active.length,
      warning: active.length > existing.length
        ? `${toolkit}: ${active.length - existing.length} additional active account(s) left unselected; set ${environmentName} to change the pin`
        : undefined,
    };
  }
  if (active.length === 1) return { ids: [active[0]!.id], activeCount: 1 };
  if (desired.requireExplicitAccountSelection) {
    fail(`${toolkit} has multiple active accounts; select them with ${environmentName}`);
  }
  return {
    ids: desired.multiAccount ? active.map((account) => account.id) : [active[0]!.id],
    activeCount: active.length,
  };
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function buildSessionSyncPlan(
  desired: ComposioDesiredState,
  session: SessionSnapshot,
  accounts: ConnectedAccount[],
  runtimePins: Record<string, string[]> = {},
): SessionSyncPlan {
  const currentConfig = record(session.config);
  const currentToolkits = readToolkitList(record(currentConfig.toolkits));
  const currentEnabledTags = readEnabledTags(record(currentConfig.tags));
  const currentTags = readDisabledTags(record(currentConfig.tags));
  const currentAccounts = readAccountMap(currentConfig.connected_accounts);
  const currentManage = record(currentConfig.manage_connections);
  const currentWorkbench = record(currentConfig.workbench ?? currentConfig.sandbox);
  const currentMulti = record(currentConfig.multi_account);
  const selectedAccounts: Record<string, string[]> = {};
  const activeAccountCounts: Record<string, number> = {};
  const selectedAccountCounts: Record<string, number> = {};
  const warnings: string[] = [];

  for (const toolkit of desired.toolkits) {
    const selection = selectedAccountsForToolkit(
      toolkit,
      accounts,
      currentAccounts,
      runtimePins,
      desired,
    );
    selectedAccounts[toolkit] = selection.ids;
    activeAccountCounts[toolkit] = selection.activeCount;
    selectedAccountCounts[toolkit] = selection.ids.length;
    if (selection.warning) warnings.push(selection.warning);
  }

  const patch: SessionPatch = {
    toolkits: { enabled: desired.toolkits },
    connected_accounts: selectedAccounts,
    tags: { enabled: desired.enableTags, disabled: desired.disableTags },
    manage_connections: {
      ...currentManage,
      enabled: desired.manageConnections,
    },
    workbench: {
      ...currentWorkbench,
      enable: desired.workbench,
      proxy_execution_enabled: desired.workbench
        ? true
        : currentWorkbench.proxy_execution_enabled === true,
    },
    multi_account: {
      ...currentMulti,
      enable: desired.multiAccount,
      require_explicit_selection: desired.requireExplicitAccountSelection,
    },
  };

  const diff: SessionDiffEntry[] = [];
  for (const toolkit of desired.toolkits.filter((entry) => !currentToolkits.includes(entry))) {
    diff.push({ kind: "add", field: "toolkit", after: toolkit });
  }
  for (const toolkit of currentToolkits.filter((entry) => !desired.toolkits.includes(entry))) {
    diff.push({ kind: "remove", field: "toolkit", before: toolkit });
  }
  for (const toolkit of desired.toolkits) {
    const before = currentAccounts[toolkit]?.length ?? 0;
    const after = selectedAccounts[toolkit]!.length;
    const beforeIds = uniqueSorted(currentAccounts[toolkit] ?? []);
    const afterIds = uniqueSorted(selectedAccounts[toolkit]!);
    if (!same(beforeIds, afterIds)) {
      diff.push({ kind: "change", field: `accounts.${toolkit}`, before, after });
    }
  }
  const policyChecks: Array<[string, unknown, unknown]> = [
    ["enable_tags", currentEnabledTags, desired.enableTags],
    ["disable_tags", currentTags, desired.disableTags],
    ["manage_connections", currentManage.enabled ?? true, desired.manageConnections],
    ["workbench", currentWorkbench.enable ?? true, desired.workbench],
    ["multi_account", currentMulti.enable ?? false, desired.multiAccount],
    [
      "require_explicit_account_selection",
      currentMulti.require_explicit_selection ?? false,
      desired.requireExplicitAccountSelection,
    ],
  ];
  for (const [field, before, after] of policyChecks) {
    if (!same(before, after)) {
      diff.push({
        kind: "change",
        field,
        before: Array.isArray(before) ? before.join(",") : before as string | number | boolean,
        after: Array.isArray(after) ? after.join(",") : after as string | number | boolean,
      });
    }
  }
  return { patch, diff, activeAccountCounts, selectedAccountCounts, warnings };
}

export function redactComposioText(input: string): string {
  return input
    .replace(/\bca_[A-Za-z0-9_-]+\b/gu, "ca_[redacted]")
    .replace(/\btrs_[A-Za-z0-9_-]+\b/gu, "trs_[redacted]")
    .replace(/(x-api-key|authorization)(["'\s:=]+)[^\s,"'}]+/giu, "$1$2[redacted]")
    .replace(/https:\/\/app\.composio\.dev\/tool_router\/[^\s"']+/gu, "[redacted-mcp-url]");
}

async function responseJson(response: Response, operation: string): Promise<unknown> {
  const body = await response.text();
  if (!response.ok) {
    const safeBody = redactComposioText(body).replace(/\s+/gu, " ").slice(0, 500);
    fail(`${operation} failed (${response.status}): ${safeBody || response.statusText}`);
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    fail(`${operation} returned invalid JSON`);
  }
}

export class HttpComposioSessionApi implements ComposioSessionApi {
  readonly #baseUrl: string;
  readonly #apiKey: string;
  readonly #fetcher: typeof fetch;

  constructor(
    apiKey: string,
    options: { baseUrl?: string; fetcher?: typeof fetch } = {},
  ) {
    this.#apiKey = apiKey;
    this.#baseUrl = (options.baseUrl ?? "https://backend.composio.dev/api/v3.1").replace(/\/$/u, "");
    this.#fetcher = options.fetcher ?? fetch;
  }

  async #request(path: string, init: RequestInit, operation: string): Promise<unknown> {
    const response = await this.#fetcher(`${this.#baseUrl}${path}`, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(20_000),
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "user-agent": "Kurami-Composio-Session-Sync/1.0",
        "x-api-key": this.#apiKey,
        ...init.headers,
      },
    });
    return responseJson(response, operation);
  }

  async getSession(sessionId: string): Promise<SessionSnapshot> {
    const value = record(await this.#request(
      `/tool_router/session/${encodeURIComponent(sessionId)}`,
      { method: "GET" },
      "Composio session lookup",
    ));
    if (typeof value.session_id !== "string" || !value.config) {
      fail("Composio session lookup returned an invalid session");
    }
    return value as SessionSnapshot;
  }

  async listConnectedAccounts(userId: string): Promise<ConnectedAccount[]> {
    const accounts: ConnectedAccount[] = [];
    let cursor: string | undefined;
    do {
      const query = new URLSearchParams({ limit: "100" });
      query.append("statuses", "ACTIVE");
      query.append("user_ids", userId);
      if (cursor) query.set("cursor", cursor);
      const value = record(await this.#request(
        `/connected_accounts?${query.toString()}`,
        { method: "GET" },
        "Composio connected-account lookup",
      ));
      const items = Array.isArray(value.items) ? value.items : [];
      for (const item of items) {
        const candidate = record(item);
        const toolkit = record(candidate.toolkit);
        if (
          typeof candidate.id === "string" &&
          typeof candidate.user_id === "string" &&
          typeof candidate.status === "string" &&
          typeof toolkit.slug === "string"
        ) {
          accounts.push(candidate as ConnectedAccount);
        }
      }
      cursor = typeof value.next_cursor === "string" && value.next_cursor
        ? value.next_cursor
        : undefined;
    } while (cursor);
    return accounts;
  }

  async createSession(config: SessionPatch & { user_id: string }): Promise<SessionSnapshot> {
    const value = record(await this.#request(
      "/tool_router/session",
      { method: "POST", body: JSON.stringify(config) },
      "Composio session creation",
    ));
    if (typeof value.session_id !== "string" || !value.config || !record(value.mcp).url) {
      fail("Composio session creation returned an invalid session");
    }
    return value as SessionSnapshot;
  }

  async patchSession(
    sessionId: string,
    patch: SessionPatch,
    configVersion?: number,
  ): Promise<SessionSnapshot> {
    const headers: Record<string, string> = {};
    if (configVersion !== undefined) headers["if-match"] = String(configVersion);
    const value = record(await this.#request(
      `/tool_router/session/${encodeURIComponent(sessionId)}`,
      { method: "PATCH", headers, body: JSON.stringify(patch) },
      "Composio session update",
    ));
    if (typeof value.session_id !== "string" || !value.config) {
      fail("Composio session update returned an invalid session");
    }
    return value as SessionSnapshot;
  }
}

function sessionUserId(session: SessionSnapshot): string {
  const value = session.config.user_id;
  if (typeof value !== "string" || !value) fail("Composio session has no user_id");
  return value;
}

function verifySession(
  before: SessionSnapshot,
  after: SessionSnapshot,
  plan: SessionSyncPlan,
): void {
  if (after.session_id !== before.session_id) fail("Composio changed the Session ID");
  if (after.mcp?.url !== before.mcp?.url) fail("Composio changed the persistent MCP URL");
  const beforeTools = uniqueSorted(before.tool_router_tools ?? []);
  const afterTools = uniqueSorted(after.tool_router_tools ?? []);
  if (!same(beforeTools, afterTools)) {
    fail("Composio changed the top-level MCP tool set; review the Hermes allowlist separately");
  }
  const verified = buildSessionSyncPlan(
    {
      version: plan.patch.tags.enabled.length > 0 ? 2 : 1,
      toolkits: plan.patch.toolkits.enabled,
      enableTags: plan.patch.tags.enabled,
      disableTags: plan.patch.tags.disabled,
      manageConnections: plan.patch.manage_connections.enabled,
      workbench: plan.patch.workbench.enable,
      multiAccount: plan.patch.multi_account.enable,
      requireExplicitAccountSelection: plan.patch.multi_account.require_explicit_selection,
    },
    after,
    Object.entries(plan.patch.connected_accounts).flatMap(([toolkit, ids]) =>
      ids.map((id) => ({
        id,
        toolkit: { slug: toolkit },
        user_id: sessionUserId(after),
        status: "ACTIVE",
      }))
    ),
  );
  if (verified.diff.length > 0) fail("Composio Session verification did not converge");
}

export async function writeSessionMeta(
  path: string,
  session: SessionSnapshot,
  plan: SessionSyncPlan,
  checkedAt = new Date().toISOString(),
): Promise<void> {
  let existing: JsonRecord = {};
  try {
    existing = record(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const snapshot = {
    ...existing,
    session_sync: {
      version: 1,
      checked_at: checkedAt,
      config_version: session.config_version ?? null,
      toolkits: plan.patch.toolkits.enabled,
      selected_account_counts: plan.selectedAccountCounts,
      active_account_counts: plan.activeAccountCounts,
      top_level_tools: uniqueSorted(session.tool_router_tools ?? []),
      policy: {
        enable_tags: plan.patch.tags.enabled,
        disable_tags: plan.patch.tags.disabled,
        manage_connections: plan.patch.manage_connections.enabled,
        workbench: plan.patch.workbench.enable,
        multi_account: plan.patch.multi_account.enable,
        require_explicit_account_selection:
          plan.patch.multi_account.require_explicit_selection,
      },
    },
  };
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
  await chmod(path, 0o600);
}

export type RunSessionSyncOptions = {
  apply: boolean;
  desiredStatePath: string;
  runtimeDirectory: string;
  api?: ComposioSessionApi;
};

export type CreateSessionOptions = {
  desiredStatePath: string;
  sourceRuntimeDirectory: string;
  targetRuntimeDirectory: string;
  api?: ComposioSessionApi;
};

export type RunSessionSyncResult = {
  applied: boolean;
  changed: boolean;
  session: SessionSnapshot;
  plan: SessionSyncPlan;
};

export async function runSessionSync(
  options: RunSessionSyncOptions,
): Promise<RunSessionSyncResult> {
  const desired = await loadDesiredState(options.desiredStatePath);
  const runtime = await loadRuntime(resolve(options.runtimeDirectory, ".env"));
  const api = options.api ?? new HttpComposioSessionApi(runtime.apiKey);
  const before = await api.getSession(runtime.sessionId);
  if (runtime.mcpUrl && before.mcp?.url && runtime.mcpUrl !== before.mcp.url) {
    fail("Runtime COMPOSIO_MCP_URL does not match the active Session URL");
  }
  const accounts = await api.listConnectedAccounts(sessionUserId(before));
  const plan = buildSessionSyncPlan(desired, before, accounts, runtime.accountPins);
  if (!options.apply) {
    return { applied: false, changed: plan.diff.length > 0, session: before, plan };
  }
  const after = plan.diff.length > 0
    ? await api.patchSession(runtime.sessionId, plan.patch, before.config_version)
    : before;
  verifySession(before, after, plan);
  await writeSessionMeta(
    resolve(options.runtimeDirectory, "mcp-meta.json"),
    after,
    plan,
  );
  return { applied: true, changed: plan.diff.length > 0, session: after, plan };
}

function environmentValue(name: string, value: string): string {
  if (!value || /[\r\n]/u.test(value)) fail(`${name} has an invalid value`);
  return `${name}=${value}`;
}

async function ensureRuntimeTargetIsEmpty(path: string): Promise<void> {
  try {
    await readFile(resolve(path, ".env"), "utf8");
    fail(`Target Composio runtime already exists: ${path}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await mkdir(path, { recursive: true });
}

export async function createSiblingSession(
  options: CreateSessionOptions,
): Promise<RunSessionSyncResult> {
  const desired = await loadDesiredState(options.desiredStatePath);
  const sourceRuntime = await loadRuntime(resolve(options.sourceRuntimeDirectory, ".env"));
  const api = options.api ?? new HttpComposioSessionApi(sourceRuntime.apiKey);
  const source = await api.getSession(sourceRuntime.sessionId);
  const accounts = await api.listConnectedAccounts(sessionUserId(source));
  const plan = buildSessionSyncPlan(desired, source, accounts, sourceRuntime.accountPins);

  await ensureRuntimeTargetIsEmpty(options.targetRuntimeDirectory);
  const created = await api.createSession({
    user_id: sessionUserId(source),
    ...plan.patch,
  });
  const mcpUrl = created.mcp?.url;
  if (!mcpUrl) fail("Created Composio session has no MCP URL");

  const verifiedPlan = buildSessionSyncPlan(desired, created, accounts);
  if (verifiedPlan.diff.length > 0) {
    fail("Created Composio session does not match the requested policy");
  }

  const runtimePath = resolve(options.targetRuntimeDirectory, ".env");
  const temporary = `${runtimePath}.${process.pid}.tmp`;
  await writeFile(
    temporary,
    `${[
      environmentValue("COMPOSIO_API_KEY", sourceRuntime.apiKey),
      environmentValue("COMPOSIO_SESSION_ID", created.session_id),
      environmentValue("COMPOSIO_MCP_URL", mcpUrl),
      "",
    ].join("\n")}`,
    { mode: 0o600 },
  );
  await chmod(temporary, 0o600);
  await rename(temporary, runtimePath);
  await chmod(runtimePath, 0o600);
  await writeSessionMeta(
    resolve(options.targetRuntimeDirectory, "mcp-meta.json"),
    created,
    verifiedPlan,
  );
  return { applied: true, changed: true, session: created, plan: verifiedPlan };
}
