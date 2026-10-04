import assert from "node:assert/strict";
import {
  assertComposioMailActionSucceeded,
  MAIL_AUTOMATION_MAX_ATTEMPTS,
  mailAutomationFailureKind,
} from "../../src/briefing/server.ts";
import { renderButton } from "../../src/ui-library/components/button.ts";
import { renderMailSection } from "../../src/briefing/ui/components/mail-section.ts";
import { renderSelectionControl } from "../../src/briefing/ui/components/selection-control.ts";
import { BRIEFING_STYLES } from "../../src/briefing/ui/styles.ts";

const primary = renderButton({
  label: "Прочитать и архивировать",
  variant: "primary",
  busyLabel: "Обрабатываю…",
  disabled: true,
  attributes: { "data-mail-archive": true },
});
assert.match(primary, /class="button button--primary"/);
assert.match(primary, /data-busy-label="Обрабатываю…" data-mail-archive disabled/);

for (const variant of ["secondary", "quiet", "icon"] as const) {
  const button = renderButton({
    label: "Проверка",
    variant,
    ...(variant === "icon" ? { icon: "↗", ariaLabel: "Открыть" } : {}),
  });
  assert.match(button, new RegExp(`button--${variant}`));
}

const rowSelection = renderSelectionControl({
  label: "Выбрать письмо",
  className: "mail-row__select",
  attributes: { "data-mail-select": true, value: "mail-1" },
});
const allSelection = renderSelectionControl({
  label: "Выбрать все",
  className: "mail-actions__select-all",
  visibleLabel: true,
  attributes: { "data-mail-select-all": true },
});
for (const selection of [rowSelection, allSelection]) {
  assert.match(selection, /data-selection-control/);
  assert.match(selection, /class="selection-control__input"/);
  assert.match(selection, /class="selection-control__box"/);
}

const mailHtml = renderMailSection({
  edition: { id: "daily:2026-08-31", timezone: "Europe/Vilnius" },
  addons: { mail: { version: 2, state: "ready", capturedAt: "2026-08-31T06:00:00Z", data: { section: {
    state: "ready",
    items: [{
      id: "mail-1",
      provider: "gmail",
      providerItemId: "gmail-message-1",
      subject: "Проверка",
      sender: "Kurami",
      class: "ACTION",
      summary: "Проверка почтового интерфейса.",
    }],
  } } } },
} as never);
assert.match(mailHtml, /class="mail-row__select" data-selection-control/);
assert.match(mailHtml, /class="mail-actions__select-all" data-selection-control/);
assert.match(mailHtml, /class="button button--success mail-actions__submit"/);
assert.doesNotMatch(mailHtml, /class="action-button"/);

assert.match(BRIEFING_STYLES, /\.button:hover:not\(:disabled\):not\(\[aria-busy="true"\]\)/);
assert.match(BRIEFING_STYLES, /\.button:active:not\(:disabled\):not\(\[aria-busy="true"\]\)/);
assert.match(BRIEFING_STYLES, /\.button:focus-visible/);
assert.match(BRIEFING_STYLES, /\.button:disabled/);
assert.match(BRIEFING_STYLES, /\.button\[aria-busy="true"\]/);
assert.match(BRIEFING_STYLES, /\.selection-control__input:indeterminate/);
assert.match(BRIEFING_STYLES, /\.selection-control__input:focus-visible/);

assert.equal(MAIL_AUTOMATION_MAX_ATTEMPTS, 3);
assert.equal(mailAutomationFailureKind(new TypeError("fetch failed")), "fetch_failed");
assert.equal(mailAutomationFailureKind(new DOMException("Timed out", "AbortError")), "timeout");
assert.equal(
  mailAutomationFailureKind(Object.assign(new Error("socket closed"), { code: "ECONNRESET" })),
  "connection",
);
assert.equal(mailAutomationFailureKind(new Error("HTTP 429 rate limit")), "rate_limited");
assert.equal(mailAutomationFailureKind(new Error("HTTP 503 Service Unavailable")), "upstream_unavailable");
assert.equal(
  mailAutomationFailureKind(new Error("Gmail provider rejected the batch action")),
  "provider_rejected",
);

for (const accepted of [
  { successful: true, error: null },
  { isError: false, structuredContent: { successful: true, error: null } },
  { isError: false, structuredContent: { ok: true } },
  { isError: false, structuredContent: { status: "completed" } },
  { isError: false, structuredContent: { data: { successful: true } } },
  {
    isError: false,
    content: [{ type: "text", text: JSON.stringify({ ok: true, error: null }) }],
  },
]) {
  assert.doesNotThrow(() => assertComposioMailActionSucceeded(accepted));
}

for (const rejected of [
  { successful: false },
  { isError: true, structuredContent: { successful: true } },
  { isError: false, structuredContent: { successful: false } },
  { isError: false, structuredContent: { ok: false } },
  { isError: false, structuredContent: { status: "failed" } },
  { isError: false, structuredContent: { error: "provider-secret-response" } },
  { isError: false, structuredContent: { data: { successful: false } } },
  { isError: false, structuredContent: { successful: true, data: { ok: false } } },
  {
    isError: false,
    content: [{
      type: "text",
      text: JSON.stringify({ successful: false, error: "provider-secret-response" }),
    }],
  },
  {
    isError: false,
    structuredContent: { successful: true },
    content: [{ type: "text", text: JSON.stringify({ ok: false }) }],
  },
  { isError: false, content: [{ type: "text", text: "ambiguous provider response" }] },
  { isError: false, structuredContent: {} },
  null,
]) {
  assert.throws(
    () => assertComposioMailActionSucceeded(rejected),
    (error: unknown) => {
      assert(error instanceof Error);
      assert.equal(error.message, "Gmail provider rejected the batch action");
      assert.equal(error.message.includes("provider-secret-response"), false);
      return true;
    },
  );
}

process.stdout.write("mail UI primitives and retry classification verified\n");
