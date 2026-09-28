import { randomUUID } from "node:crypto";
import { chmod, readFile, rename, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { briefingAddonEnabled, type BriefingPayload } from "./model.ts";
import { section } from "./addons/envelopes.ts";
import type { EditionRow } from "./edition-store.ts";
import { briefingPaths, type BriefingPaths } from "./paths.ts";

function fail(message: string): never {
  throw new Error(message);
}

function htmlHasAttributes(html: string, attributes: Record<string, string | null>): boolean {
  const tags = html.match(/<[a-z][^>]*>/gi) ?? [];
  return tags.some((tag) =>
    Object.entries(attributes).every(([name, value]) => {
      const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (value === null) return new RegExp(`\\s${escapedName}(?:\\s|=|>|\\/)`, "i").test(tag);
      const escapedValue = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`\\s${escapedName}\\s*=\\s*["']${escapedValue}["']`, "i").test(tag);
    }),
  );
}

export function validateRenderedHtml(html: string, payload?: BriefingPayload): void {
  if (Buffer.byteLength(html, "utf8") > 2 * 1024 * 1024) fail("Rendered HTML exceeds 2 MiB");
  if (!/^\s*<!doctype html>/i.test(html)) fail("Rendered HTML must begin with a doctype");
  if (!/<html\b/i.test(html) || !/<body\b/i.test(html) || !/<\/body>/i.test(html)) {
    fail("Rendered HTML must contain html and body elements");
  }
  const forbidden: Array<[RegExp, string]> = [
    [/<script\b/i, "script elements"],
    [/<(?:iframe|object|embed|base|form)\b/i, "active embedded content"],
    [/<[a-z][^>]*\son[a-z]+\s*=/i, "inline event handlers"],
    [/<meta[^>]+http-equiv\s*=\s*["']?refresh/i, "meta refresh"],
  ];
  for (const [pattern, label] of forbidden) {
    if (pattern.test(html)) fail(`Rendered HTML contains forbidden ${label}`);
  }
  if (!htmlHasAttributes(html, { "data-theme-toggle": null })) {
    fail("Rendered HTML must contain a visible theme toggle");
  }
  if (!payload) return;

  for (const story of briefingAddonEnabled(payload, "news") ? section(payload, "news").items : []) {
    const itemAttributes = { "data-item-id": story.id };
    if (!htmlHasAttributes(html, { ...itemAttributes, "data-feed-item": null })) {
      fail(`Rendered HTML is missing feed item ${story.id}`);
    }
    if (
      !htmlHasAttributes(html, {
        ...itemAttributes,
        "data-edition-id": payload.edition.id,
        "data-story-details": null,
      })
    ) {
      fail(`Rendered HTML is missing expandable details for ${story.id}`);
    }
  }

  const pageSize = section(payload, "news").pageSize ?? 10;
  if (briefingAddonEnabled(payload, "news") && section(payload, "news").items.length > pageSize) {
    for (const attribute of [
      "data-paginated-feed",
      "data-feed-pagination",
      "data-page-prev",
      "data-page-next",
      "data-page-status",
    ]) {
      if (!htmlHasAttributes(html, { [attribute]: null })) {
        fail(`Rendered HTML is missing pagination hook ${attribute}`);
      }
    }
  }
}

export async function atomicWrite(path: string, content: string): Promise<void> {
  const candidate = `${path}.${randomUUID().replaceAll("-", "")}.tmp`;
  await writeFile(candidate, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await rename(candidate, path);
  await chmod(path, 0o600);
}

export function relativeHtmlPath(paths: BriefingPaths, payload: BriefingPayload): string {
  return relative(
    paths.stateDirectory,
    resolve(paths.previewDirectory, `${payload.edition.type}-${payload.edition.localDate}.html`),
  );
}

export function resolvedHtmlPath(paths: BriefingPaths, storedPath: string): string {
  if (isAbsolute(storedPath) || storedPath.includes("..")) fail("Unsafe stored HTML path");
  const candidate = resolve(paths.stateDirectory, storedPath);
  const child = relative(paths.pagesDirectory, candidate);
  if (child.startsWith("..") || resolve(paths.pagesDirectory, child) !== candidate) {
    fail("Stored HTML path escapes briefing pages");
  }
  return candidate;
}

export async function readEditionHtml(
  edition: EditionRow,
  paths: BriefingPaths = briefingPaths(),
): Promise<string> {
  return readFile(resolvedHtmlPath(paths, edition.html_path), "utf8");
}
