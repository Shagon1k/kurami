import {escapeHtml} from "../foundations/html.ts";

// An explanation behind a small "i": the text that explains a control rather than showing data stays out of
// the way until asked for. The note is a tooltip: a popover the runtime (runtime/theme.ts) opens next to its
// button on click or hover and closes on a click elsewhere or Escape; in the top layer it works the same in
// menus, sheets and dialogs and never pushes the layout.
// Its CSS ships inside THEME_SWITCH_CSS: every page carries the theme switch, which uses it too.
export const INFO_TIP_CSS = `
.ui-info { position: relative; display: inline-grid; place-items: center; flex: none; inline-size: 22px; block-size: 22px; margin-inline-start: var(--space-1); padding: 0; border: 1px solid color-mix(in srgb, var(--status-info) 55%, var(--border-default)); border-radius: 50%; color: var(--status-info); background: color-mix(in srgb, var(--status-info) 8%, transparent); font: 600 .72rem/1 var(--font-mono); text-transform: none; letter-spacing: 0; vertical-align: middle; cursor: pointer; }
.ui-info::before { content: ""; position: absolute; inset: -11px; }
.ui-info:hover, .ui-info[aria-expanded="true"] { color: var(--surface-page); background: var(--status-info); border-color: var(--status-info); }
.ui-info:focus-visible { outline: 3px solid var(--focus-ring); outline-offset: 2px; }
/* A true tooltip: a popover in the top layer (above dialogs and sheets), placed by the runtime next to its button. */
.ui-info-note { --info-top: 0px; --info-left: 0px; position: fixed; inset: auto; top: var(--info-top); left: var(--info-left); z-index: 90; width: max-content; max-width: min(320px, calc(100vw - 16px)); margin: 0; padding: var(--space-2) var(--space-3); box-shadow: var(--shadow-raised); color: var(--text-primary); background: color-mix(in srgb, var(--status-info) 7%, var(--surface-raised)); border: 1px solid color-mix(in srgb, var(--status-info) 35%, var(--border-default)); border-radius: var(--radius); font: 400 .8rem/1.5 var(--font-sans); text-transform: none; letter-spacing: 0; }
.ui-info-note:not(:popover-open) { display: none; }
`;

/** The "i" button; pair it with renderInfoNote using the same id. */
export function renderInfoButton(input: { id: string; label: string }): string {
  if (!/^[a-z][a-z0-9-]*$/.test(input.id)) throw new Error("Invalid info tip ID");
  return `<button class="ui-info" type="button" data-ui-info popovertarget="${input.id}" aria-expanded="false" aria-controls="${input.id}" aria-label="${escapeHtml(input.label)}">i</button>`;
}

/** The note the button reveals; trusted plain text. */
export function renderInfoNote(input: { id: string; text: string }): string {
  if (!/^[a-z][a-z0-9-]*$/.test(input.id)) throw new Error("Invalid info tip ID");
  return `<p class="ui-info-note" id="${input.id}" role="tooltip" popover="auto">${escapeHtml(input.text)}</p>`;
}
