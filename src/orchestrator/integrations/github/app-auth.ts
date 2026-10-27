import { readFileSync, realpathSync, statSync } from "node:fs";
import { createSign } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { relative, resolve } from "node:path";

// Shared authentication boundary for GitHub-backed orchestrator workflows.

process.umask(0o077);

export const reviewerAppEnvironmentKeys = [
  "KURAMI_GITHUB_REVIEWER_APP_ID",
  "KURAMI_GITHUB_REVIEWER_INSTALLATION_ID",
  "KURAMI_GITHUB_REVIEWER_PRIVATE_KEY_FILE",
] as const;

export type GitHubAppCredentials = {
  appId: string;
  installationId: string;
  privateKey: string;
};

const ownerTokenEnvironmentKeys = ["GH_TOKEN", "GITHUB_TOKEN"] as const;

type FetchImplementation = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

function fail(message: string): never {
  throw new Error(message);
}

function requiredNumericEnvironment(
  environment: NodeJS.ProcessEnv,
  name: (typeof reviewerAppEnvironmentKeys)[number],
): string {
  const value = environment[name]?.trim();
  if (!value || !/^\d+$/u.test(value))
    fail(`${name} must be a numeric identifier`);
  return value;
}

function base64Url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

export function createGitHubAppJwt(
  appId: string,
  privateKey: string,
  nowSeconds = Math.floor(Date.now() / 1_000),
): string {
  if (!/^\d+$/u.test(appId)) fail("GitHub App ID must be numeric");
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(
    JSON.stringify({
      iat: nowSeconds - 60,
      exp: nowSeconds + 9 * 60,
      iss: appId,
    }),
  );
  const unsigned = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  return `${unsigned}.${signer.sign(privateKey).toString("base64url")}`;
}

export async function loadGitHubAppCredentials(
  orchestratorHome: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<GitHubAppCredentials> {
  const appId = requiredNumericEnvironment(
    environment,
    "KURAMI_GITHUB_REVIEWER_APP_ID",
  );
  const installationId = requiredNumericEnvironment(
    environment,
    "KURAMI_GITHUB_REVIEWER_INSTALLATION_ID",
  );
  const configuredKeyFile =
    environment.KURAMI_GITHUB_REVIEWER_PRIVATE_KEY_FILE?.trim();
  if (!configuredKeyFile)
    fail("KURAMI_GITHUB_REVIEWER_PRIVATE_KEY_FILE is required");
  const secretsDirectory = await realpath(resolve(orchestratorHome, "secrets"));
  const keyFile = await realpath(resolve(configuredKeyFile));
  const keyRelative = relative(secretsDirectory, keyFile);
  if (
    !keyRelative ||
    keyRelative.startsWith("..") ||
    resolve(secretsDirectory, keyRelative) !== keyFile
  )
    fail("GitHub App private key must be inside the orchestrator secrets directory");
  const keyStat = await stat(keyFile);
  if (!keyStat.isFile()) fail("GitHub App private key is not a regular file");
  if ((keyStat.mode & 0o077) !== 0)
    fail("GitHub App private key permissions are too broad");
  const privateKey = await readFile(keyFile, "utf8");
  if (
    !privateKey.includes("BEGIN RSA PRIVATE KEY") &&
    !privateKey.includes("BEGIN PRIVATE KEY")
  )
    fail("GitHub App private key is not a PEM private key");
  return { appId, installationId, privateKey };
}

export async function loadGitHubAppCredentialsFromFile(
  orchestratorHome: string,
): Promise<GitHubAppCredentials> {
  const environmentFile = resolve(
    orchestratorHome,
    "secrets/github-reviewer-app.env",
  );
  const environmentStat = await stat(environmentFile);
  if (!environmentStat.isFile()) fail("GitHub App environment is not a file");
  if ((environmentStat.mode & 0o077) !== 0)
    fail("GitHub App environment permissions are too broad");
  const content = await readFile(environmentFile, "utf8");
  const environment: NodeJS.ProcessEnv = {};
  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Z][A-Z0-9_]*)=(.*)$/u.exec(line);
    if (!match || !reviewerAppEnvironmentKeys.includes(match[1] as never))
      fail("GitHub App environment contains an unsupported entry");
    if (environment[match[1]]) fail("GitHub App environment contains a duplicate entry");
    let value = match[2]!.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    )
      value = value.slice(1, -1);
    environment[match[1]!] = value;
  }
  return loadGitHubAppCredentials(orchestratorHome, environment);
}

export async function loadOwnerGitHubTokenFromFile(home: string): Promise<string> {
  return loadOwnerGitHubTokenFromFileSync(home);
}

export function loadOwnerGitHubTokenFromFileSync(
  orchestratorHome: string,
): string {
  const secretsDirectory = realpathSync(resolve(orchestratorHome, "secrets"));
  const environmentFile = realpathSync(
    resolve(secretsDirectory, "github.env"),
  );
  const environmentRelative = relative(secretsDirectory, environmentFile);
  if (
    !environmentRelative ||
    environmentRelative.startsWith("..") ||
    resolve(secretsDirectory, environmentRelative) !== environmentFile
  )
    fail("GitHub owner environment must be inside the orchestrator secrets directory");
  const environmentStat = statSync(environmentFile);
  if (!environmentStat.isFile()) fail("GitHub owner environment is not a file");
  if ((environmentStat.mode & 0o077) !== 0)
    fail("GitHub owner environment permissions are too broad");
  const content = readFileSync(environmentFile, "utf8");
  const tokens = new Map<string, string>();
  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Z][A-Z0-9_]*)=(.*)$/u.exec(line);
    if (!match) fail("GitHub owner environment contains an invalid entry");
    if (!ownerTokenEnvironmentKeys.includes(match[1] as never)) continue;
    if (tokens.has(match[1]!))
      fail("GitHub owner environment contains a duplicate token entry");
    let value = match[2]!.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    )
      value = value.slice(1, -1);
    tokens.set(match[1]!, value);
  }
  const token = tokens.get("GH_TOKEN") ?? tokens.get("GITHUB_TOKEN") ?? "";
  if (!/^[A-Za-z0-9_]{20,255}$/u.test(token))
    fail("GitHub owner environment contains no valid token");
  return token;
}

export async function createGitHubAppInstallationToken(
  credentials: GitHubAppCredentials,
  fetchImplementation: FetchImplementation = fetch,
  nowSeconds = Math.floor(Date.now() / 1_000),
): Promise<string> {
  if (!/^\d+$/u.test(credentials.installationId))
    fail("GitHub App installation ID must be numeric");
  const jwt = createGitHubAppJwt(
    credentials.appId,
    credentials.privateKey,
    nowSeconds,
  );
  const response = await fetchImplementation(
    `https://api.github.com/app/installations/${credentials.installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${jwt}`,
        "User-Agent": "kurami-orchestrator",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok) {
    const details = (await response.text()).trim().slice(0, 500);
    fail(
      `GitHub App installation token request failed: HTTP ${response.status}${details ? `; ${details}` : ""}`,
    );
  }
  const result = (await response.json()) as {
    token?: unknown;
    expires_at?: unknown;
  };
  const token = typeof result.token === "string" ? result.token.trim() : "";
  const expiresAt =
    typeof result.expires_at === "string" ? Date.parse(result.expires_at) : Number.NaN;
  if (!token || token.length > 2_048)
    fail("GitHub returned no valid installation token");
  if (!Number.isFinite(expiresAt) || expiresAt <= (nowSeconds + 60) * 1_000)
    fail("GitHub returned an already-expired installation token");
  return token;
}
