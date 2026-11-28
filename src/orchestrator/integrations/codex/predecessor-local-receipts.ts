import { createHash } from 'node:crypto';
import { constants, closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { MAX_IMAGE_BYTES } from './predecessor-images.ts';

/** Read only an exact native local-image receipt inside this worktree's attachment store. */
export function localReceiptImageHash(path: unknown, worktree: string): string {
  if (typeof path !== 'string' || !isAbsolute(path) || resolve(path) !== path)
    throw new Error('unsafe or missing local-image receipt attachment');
  const store = resolve(worktree, '.codex-attachments');
  const within = relative(store, path);
  if (!within || within === '..' || within.startsWith('..' + sep) || isAbsolute(within))
    throw new Error('local-image receipt is outside the current worktree attachment store');
  let directory: number | undefined;
  let file: number | undefined;
  try {
    // Pin every directory component. A final O_NOFOLLOW alone does not fence directory symlinks.
    directory = openSync('/', constants.O_RDONLY | constants.O_DIRECTORY);
    const components = path.split('/').slice(1);
    for (const component of components.slice(0, -1)) {
      const next = openSync(`/proc/self/fd/${directory}/${component}`,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      closeSync(directory);
      directory = next;
    }
    file = openSync(`/proc/self/fd/${directory}/${components.at(-1)}`,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = fstatSync(file);
    if (!before.isFile() || before.size < 1 || before.size > MAX_IMAGE_BYTES)
      throw new Error();
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const length = readSync(file, bytes, offset, bytes.length - offset, offset);
      if (!length) throw new Error();
      offset += length;
    }
    const after = fstatSync(file);
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs)
      throw new Error();
    // Pixel validation is already performed on the inline image; canonical receipt equality
    // requires this digest to match those exact original bytes, without fetching/transcoding.
    return createHash('sha256').update(bytes).digest('hex');
  } catch {
    throw new Error('missing, changed, oversized, or unsafe local-image receipt attachment');
  } finally {
    if (file !== undefined) closeSync(file);
    if (directory !== undefined) closeSync(directory);
  }
}
