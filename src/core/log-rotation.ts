// Size-based log rotation for append-only logs: when a log outgrows its limit it becomes `<name>.1` (the
// previous `.1` is dropped) and writing starts a fresh file. Monthly maintenance removes old copies by age.
import { rename, stat } from "node:fs/promises";

export const LOG_ROTATE_BYTES = 8 * 1024 * 1024;

/** Rotates `path` if it is larger than `maxBytes`. Another writer may rotate first; that is fine. */
export async function rotateIfLarge(path: string, maxBytes = LOG_ROTATE_BYTES): Promise<boolean> {
  try {
    if ((await stat(path)).size <= maxBytes) return false;
    await rename(path, `${path}.1`);
    return true;
  } catch { return false; }
}
