// Document shell shared by every Kurami site: head, skip link, header, main landmark and footer.
import { escapeHtml } from "../foundations/html.ts";
import { THEME_SCRIPT_TAG } from "../runtime/theme.ts";
import { kuramiTheme } from "../themes/index.ts";

export type DocumentInput = {
  lang: string;
  title: string;
  description?: string;
  favicon: string;
  /** Inline CSS for self-contained artifacts, or a stylesheet URL. */
  styles: { inline: string } | { href: string };
  /** Script-free artifacts (Digest) get the runtime injected when served instead. */
  themeScript: boolean;
  skipLabel: string;
  /** Trusted HTML from library patterns and product renderers. */
  header: string;
  main: string;
  mainClass?: string;
  footer: string;
  after?: string;
};

export function renderDocument(input: DocumentInput): string {
  if (!/^[a-z]{2}(?:-[A-Z]{2})?$/.test(input.lang)) throw new Error("Invalid document language");
  const styles = "inline" in input.styles
    ? `<style>${input.styles.inline}</style>`
    : `<link rel="stylesheet" href="${escapeHtml(input.styles.href)}">`;
  const description = input.description ? `<meta name="description" content="${escapeHtml(input.description)}">` : "";
  const mainClass = ["container", input.mainClass].filter(Boolean).join(" ");
  return `<!doctype html>
<html lang="${input.lang}" data-theme="light">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <meta name="theme-color" content="${kuramiTheme.light.colors["surface-page"]}">
  <title>${escapeHtml(input.title)}</title>
  ${description}<link rel="icon" type="image/svg+xml" href="${escapeHtml(input.favicon)}">
  ${styles}${input.themeScript ? THEME_SCRIPT_TAG : ""}
</head>
<body>
  <a class="skip-link" href="#main">${escapeHtml(input.skipLabel)}</a>
  ${input.header}
  <main id="main" class="${escapeHtml(mainClass)}" tabindex="-1">${input.main}</main>
  ${input.footer}${input.after ?? ""}
</body>
</html>`;
}
