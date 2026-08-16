export const CODEX_DEEPLINK_HOST = "go.shagon1k.win";
export const CODEX_DEEPLINK_PATH_PREFIX = "/codex/threads";
export const CODEX_THREAD_ID_PATTERN =
  "[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}";

const codexThreadId = new RegExp(`^${CODEX_THREAD_ID_PATTERN}$`, "u");

export function codexLaunchUrl(threadId: string | null): string | null {
  if (!threadId || !codexThreadId.test(threadId)) return null;
  return `https://${CODEX_DEEPLINK_HOST}${CODEX_DEEPLINK_PATH_PREFIX}/${threadId}`;
}
