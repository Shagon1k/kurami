const redactedCredential = "[REDACTED_CREDENTIAL]";

const credentialPatterns = [
  /github_pat_[A-Za-z0-9_]{20,}/gu,
  /gh[opusr]_[A-Za-z0-9]{20,}/gu,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/gu,
  /\bAGE-SECRET-KEY-1[A-Z0-9-]{20,}\b/gu,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/gu,
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/gu,
  /\b(?:GH_TOKEN|GITHUB_TOKEN|AWS_SECRET_ACCESS_KEY|AWS_SESSION_TOKEN|DISCORD_BOT_TOKEN|OPENAI_API_KEY|ANTHROPIC_API_KEY|GOOGLE_CLIENT_SECRET)\s*[:=]\s*["']?[^\s"']{12,}["']?/giu,
] as const;

export function redactSecretLikeText(value: string): string {
  const normalized = value
    .normalize("NFKC")
    .replace(/[\u200b-\u200d\u2060\ufeff]/gu, "");
  return credentialPatterns.reduce(
    (current, pattern) => current.replace(pattern, redactedCredential),
    normalized,
  );
}

export function assertNoSecretLikeText(value: string, label: string): void {
  if (redactSecretLikeText(value) !== value) {
    throw new Error(`${label} contains credential-like material`);
  }
}

export function sanitizeUntrustedPromptData<T>(value: T): T {
  if (typeof value === "string") return redactSecretLikeText(value) as T;
  if (Array.isArray(value))
    return value.map((entry) => sanitizeUntrustedPromptData(entry)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        sanitizeUntrustedPromptData(entry),
      ]),
    ) as T;
  }
  return value;
}

export function serializeUntrustedPromptData(value: unknown): string {
  return JSON.stringify(sanitizeUntrustedPromptData(value), null, 2)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

const exactSecretEnvironmentNames = new Set([
  "DATABASE_URL",
  "GPG_AGENT_INFO",
  "POSTGRES_URL",
  "REDIS_URL",
  "SSH_AUTH_SOCK",
]);

export function isSecretEnvironmentName(name: string): boolean {
  return (
    exactSecretEnvironmentNames.has(name.toUpperCase()) ||
    /(?:^|_)(?:TOKEN|SECRET|PASSWORD|PASSWD|PRIVATE_KEY|ACCESS_KEY|API_KEY|CREDENTIALS?|COOKIE)(?:_|$)/iu.test(
      name,
    )
  );
}
