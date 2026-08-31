import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  unlink,
} from "node:fs/promises";
import { extname, relative, resolve, sep } from "node:path";
import { parseBriefingPayload, type BriefingPayload, type StoryMedia } from "./model.ts";
import {
  type BriefingPaths,
  initializeBriefingStore,
  loadEdition,
  openBriefingDatabase,
  preparePreview,
} from "./store.ts";
import { renderBriefingPage } from "./ui/render-page.ts";

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_VIDEO_BYTES = 768 * 1024 * 1024;
const MAX_EDITION_MEDIA_BYTES = 1024 * 1024 * 1024;

const TYPES = new Map<string, { kind: StoryMedia["kind"]; mimeType: string }>([
  [".avif", { kind: "image", mimeType: "image/avif" }],
  [".gif", { kind: "image", mimeType: "image/gif" }],
  [".jpeg", { kind: "image", mimeType: "image/jpeg" }],
  [".jpg", { kind: "image", mimeType: "image/jpeg" }],
  [".png", { kind: "image", mimeType: "image/png" }],
  [".webp", { kind: "image", mimeType: "image/webp" }],
  [".mov", { kind: "video", mimeType: "video/quicktime" }],
  [".mp4", { kind: "video", mimeType: "video/mp4" }],
  [".webm", { kind: "video", mimeType: "video/webm" }],
]);

type ManifestAsset = {
  sourcePath: string;
  alt?: string;
  sourceKey?: string;
  providerItemId?: string;
};

type ManifestStory = {
  itemId: string;
  assets: ManifestAsset[];
};

type MediaManifest = {
  editionId: string;
  stories: ManifestStory[];
};

type StagedStory = {
  targetDirectory: string;
  stagingDirectory: string;
  media: StoryMedia[];
};

type SwappedStory = {
  targetDirectory: string;
  backupDirectory: string | null;
};

function fail(message: string): never {
  throw new Error(`Invalid media import: ${message}`);
}

function safeChild(root: string, value: string, label: string): string {
  const candidate = resolve(value);
  const child = relative(root, candidate);
  if (child === "" || child.startsWith("..") || resolve(root, child) !== candidate) {
    fail(`${label} escapes the media inbox`);
  }
  return candidate;
}

function safeSegment(value: string): string {
  const result = value.replaceAll(/[^A-Za-z0-9._-]/g, "-").replaceAll(/-+/g, "-");
  if (!result || result === "." || result === "..") fail("unsafe media path segment");
  return result;
}

async function optionalStat(path: string): Promise<Awaited<ReturnType<typeof lstat>> | null> {
  try {
    return await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function parseManifest(value: unknown): MediaManifest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail("root must be an object");
  const root = value as Record<string, unknown>;
  if (typeof root.editionId !== "string" || root.editionId.trim() === "") fail("editionId is required");
  if (!Array.isArray(root.stories) || root.stories.length < 1) fail("stories must be a non-empty array");
  const seen = new Set<string>();
  const stories = root.stories.map((raw, storyIndex) => {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) fail(`stories[${storyIndex}] must be an object`);
    const story = raw as Record<string, unknown>;
    if (typeof story.itemId !== "string" || story.itemId.trim() === "") fail(`stories[${storyIndex}].itemId is required`);
    if (seen.has(story.itemId)) fail(`duplicate story ${story.itemId}`);
    seen.add(story.itemId);
    if (!Array.isArray(story.assets) || story.assets.length < 1 || story.assets.length > 12) {
      fail(`stories[${storyIndex}].assets must contain one to twelve files`);
    }
    const assets = story.assets.map((assetRaw, assetIndex) => {
      if (typeof assetRaw !== "object" || assetRaw === null || Array.isArray(assetRaw)) {
        fail(`stories[${storyIndex}].assets[${assetIndex}] must be an object`);
      }
      const asset = assetRaw as Record<string, unknown>;
      if (typeof asset.sourcePath !== "string" || asset.sourcePath.trim() === "") {
        fail(`stories[${storyIndex}].assets[${assetIndex}].sourcePath is required`);
      }
      if (asset.alt !== undefined && (typeof asset.alt !== "string" || asset.alt.length > 240)) {
        fail(`stories[${storyIndex}].assets[${assetIndex}].alt is invalid`);
      }
      if ((asset.sourceKey === undefined) !== (asset.providerItemId === undefined)) {
        fail(`stories[${storyIndex}].assets[${assetIndex}] sourceKey and providerItemId must be supplied together`);
      }
      if (asset.sourceKey !== undefined
        && (typeof asset.sourceKey !== "string" || !/^telegram:[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(asset.sourceKey))) {
        fail(`stories[${storyIndex}].assets[${assetIndex}].sourceKey is invalid`);
      }
      if (asset.providerItemId !== undefined
        && (typeof asset.providerItemId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(asset.providerItemId))) {
        fail(`stories[${storyIndex}].assets[${assetIndex}].providerItemId is invalid`);
      }
      return {
        sourcePath: asset.sourcePath,
        ...(typeof asset.alt === "string" ? { alt: asset.alt } : {}),
        ...(typeof asset.sourceKey === "string" && typeof asset.providerItemId === "string"
          ? { sourceKey: asset.sourceKey, providerItemId: asset.providerItemId }
          : {}),
      };
    });
    return { itemId: story.itemId, assets };
  });
  return { editionId: root.editionId, stories };
}

export async function readMediaManifest(path: string): Promise<MediaManifest> {
  const content = await readFile(path, "utf8");
  if (Buffer.byteLength(content, "utf8") > 128 * 1024) fail("manifest exceeds 128 KiB");
  return parseManifest(JSON.parse(content) as unknown);
}

export async function importEditionMedia(
  manifestValue: unknown,
  paths: BriefingPaths,
): Promise<{ editionId: string; imported: number; bytes: number; previewPath: string }> {
  const manifest = parseManifest(manifestValue);
  await initializeBriefingStore(paths);
  const database = openBriefingDatabase(paths);
  let payload: BriefingPayload;
  try {
    database.exec("BEGIN IMMEDIATE");
    try {
      const edition = loadEdition(database, { id: manifest.editionId });
      if (!edition) fail(`unknown edition ${manifest.editionId}`);
      if (edition.state !== "prepared") fail(`edition ${manifest.editionId} is not prepared`);
      payload = parseBriefingPayload(JSON.parse(edition.payload_json) as unknown);

      // Invalidate the content/media-bound Telegram gate before the first
      // filesystem mutation. A failed import can leave a partial staging copy,
      // so no previously issued plan may remain usable afterward.
      database.prepare("DELETE FROM telegram_validation_receipts WHERE edition_id = ?")
        .run(manifest.editionId);
      database.prepare("UPDATE editions SET updated_at = ? WHERE id = ?")
        .run(new Date().toISOString(), manifest.editionId);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  } finally {
    database.close();
  }

  const storyById = new Map(payload.news.items.map((story) => [story.id, story]));
  const editionDirectory = resolve(paths.mediaDirectory, payload.edition.type, payload.edition.localDate);
  await mkdir(editionDirectory, { recursive: true, mode: 0o700 });
  const stagingRoot = await mkdtemp(resolve(paths.mediaInboxDirectory, ".media-import-"));
  const stagedFiles: string[] = [];
  const stagedStories: StagedStory[] = [];
  const swappedStories: SwappedStory[] = [];
  let imported = 0;
  let bytes = 0;
  let mediaCommitted = false;
  let preserveStagingForRecovery = false;

  try {
    for (const manifestStory of manifest.stories) {
      const story = storyById.get(manifestStory.itemId);
      if (!story) fail(`unknown story ${manifestStory.itemId}`);
      const storySegment = safeSegment(story.id);
      const storyDirectory = resolve(editionDirectory, storySegment);
      const stagingDirectory = resolve(stagingRoot, storySegment);
      await mkdir(stagingDirectory, { mode: 0o700 });
      const media: StoryMedia[] = [];
      for (const [index, manifestAsset] of manifestStory.assets.entries()) {
        const sourcePath = safeChild(paths.mediaInboxDirectory, manifestAsset.sourcePath, "sourcePath");
        const extension = extname(sourcePath).toLowerCase();
        const type = TYPES.get(extension);
        if (!type) fail(`unsupported media extension ${extension || "(none)"}`);
        const sourceStat = await stat(sourcePath);
        if (!sourceStat.isFile()) fail(`${sourcePath} is not a file`);
        const limit = type.kind === "image" ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
        if (sourceStat.size > limit) fail(`${sourcePath} exceeds the ${type.kind} size limit`);
        bytes += sourceStat.size;
        if (bytes > MAX_EDITION_MEDIA_BYTES) fail("edition media exceeds 1 GiB");
        const name = `${String(index + 1).padStart(2, "0")}${extension}`;
        const stagedDestination = resolve(stagingDirectory, name);
        const finalDestination = resolve(storyDirectory, name);
        await copyFile(sourcePath, stagedDestination);
        await chmod(stagedDestination, 0o600);
        stagedFiles.push(sourcePath);
        const publicPath = `/${relative(paths.stateDirectory, finalDestination).split(sep).join("/")}`
          .replace(/^\/media\//, "/media/");
        const alt = manifestAsset.alt?.trim() || `${story.headline} — медиа ${index + 1}`;
        media.push({
          id: `${storySegment}-media-${index + 1}`,
          kind: type.kind,
          src: publicPath,
          alt,
          mimeType: type.mimeType,
          ...(manifestAsset.sourceKey && manifestAsset.providerItemId
            ? {
                sourceKey: manifestAsset.sourceKey,
                providerItemId: manifestAsset.providerItemId,
              }
            : {}),
        });
        imported += 1;
      }
      stagedStories.push({ targetDirectory: storyDirectory, stagingDirectory, media });
    }

    for (const [index, stagedStory] of stagedStories.entries()) {
      const existing = await optionalStat(stagedStory.targetDirectory);
      if (existing && !existing.isDirectory()) {
        fail(`story media target ${stagedStory.targetDirectory} is not a directory`);
      }
      const backupDirectory = existing ? resolve(stagingRoot, `.backup-${index}`) : null;
      if (backupDirectory) await rename(stagedStory.targetDirectory, backupDirectory);
      try {
        await rename(stagedStory.stagingDirectory, stagedStory.targetDirectory);
      } catch (error) {
        if (backupDirectory) {
          try {
            await rename(backupDirectory, stagedStory.targetDirectory);
          } catch (restoreError) {
            preserveStagingForRecovery = true;
            throw new AggregateError(
              [error, restoreError],
              `Failed to swap and restore media directory for ${stagedStory.targetDirectory}`,
            );
          }
        }
        throw error;
      }
      swappedStories.push({ targetDirectory: stagedStory.targetDirectory, backupDirectory });
    }

    for (const [index, manifestStory] of manifest.stories.entries()) {
      storyById.get(manifestStory.itemId)!.media = stagedStories[index]!.media;
    }

    const previousMediaSummary = typeof payload.dataQuality.mediaSummary === "string"
      ? payload.dataQuality.mediaSummary.trim()
      : "";
    const priorCollection = typeof payload.dataQuality.telegramCollection === "object"
        && payload.dataQuality.telegramCollection !== null
        && !Array.isArray(payload.dataQuality.telegramCollection)
      ? payload.dataQuality.telegramCollection as Record<string, unknown>
      : {};
    payload.dataQuality.telegramCollection = {
      ...priorCollection,
      downloaded: imported,
      imported,
      storiesWithMedia: manifest.stories.length,
    };
    const mediaSummary = imported > 0
      ? `${imported} медиафайлов сохранено для ${manifest.stories.length} сюжетов.`
      : "В этом выпуске медиафайлов нет.";
    payload.dataQuality.mediaSummary = mediaSummary;
    let qualitySummary = typeof payload.dataQuality.summary === "string"
      ? payload.dataQuality.summary.trim()
      : "";
    if (previousMediaSummary && qualitySummary.endsWith(previousMediaSummary)) {
      qualitySummary = qualitySummary.slice(0, -previousMediaSummary.length).trim();
    }
    payload.dataQuality.summary = qualitySummary
      ? `${qualitySummary.replace(/\s+$/u, "")} ${mediaSummary}`
      : mediaSummary;

    const parsed = parseBriefingPayload(payload);
    const prepared = await preparePreview(parsed, renderBriefingPage(parsed), paths);
    mediaCommitted = true;
    for (const stagedFile of stagedFiles) {
      await unlink(stagedFile).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
    return { editionId: manifest.editionId, imported, bytes, previewPath: prepared.previewPath };
  } catch (error) {
    if (!mediaCommitted) {
      try {
        for (const [index, swappedStory] of [...swappedStories].reverse().entries()) {
          const failedDirectory = resolve(stagingRoot, `.failed-${index}`);
          await rename(swappedStory.targetDirectory, failedDirectory);
          if (swappedStory.backupDirectory) {
            await rename(swappedStory.backupDirectory, swappedStory.targetDirectory);
          }
        }
      } catch (rollbackError) {
        preserveStagingForRecovery = true;
        throw new AggregateError([error, rollbackError], "Media import failed and rollback was incomplete");
      }
    }
    throw error;
  } finally {
    if (!preserveStagingForRecovery) {
      await rm(stagingRoot, { recursive: true, force: true });
    }
  }
}
