import { createSign } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { relative, resolve } from "node:path";

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
