import {escapeHtml} from "./html.ts";
import {renderThemeToggle} from "./components/theme-toggle.ts";
import {BRIEFING_STYLES} from "./styles.ts";

/** Only trusted component-rendered HTML enters content; metadata is escaped. */
export function renderPageShell(input:{title:string;brand:string;date:string;dateLabel:string;generated:string;timezone:string;content:string}):string {
  return `<!doctype html>
<html lang="ru" data-theme="light">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <meta name="theme-color" content="#fbfbf8">
  <title>${escapeHtml(input.title)} · Kurami</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Caveat:wght@600&family=Fragment+Mono&family=Onest:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>${BRIEFING_STYLES}</style>
</head>
<body>
  <a class="skip-link" href="#main">К содержанию</a>
  <header class="utility-header" data-utility-header>
    <div class="utility-header__inner page-shell">
      <div class="utility-brand"><span class="utility-brand__mark" aria-hidden="true">K</span><span>${escapeHtml(input.brand)}</span></div>
      <time class="utility-meta" datetime="${escapeHtml(input.date)}">${escapeHtml(input.dateLabel)}</time>
      <div class="utility-actions">${renderThemeToggle()}</div>
    </div>
  </header>
  <main id="main" class="page-shell">${input.content}</main>
  <footer class="page-footer page-shell"><span>Kurami · ${escapeHtml(input.date)}</span><span>Собрано в ${escapeHtml(input.generated)} · ${escapeHtml(input.timezone)}</span></footer>
  <dialog class="media-lightbox" data-media-dialog aria-label="Просмотр изображения"><button class="media-lightbox__close" type="button" data-media-close aria-label="Закрыть">×</button><img data-media-dialog-image alt=""></dialog>
</body>
</html>`;
}
