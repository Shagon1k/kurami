// Completion celebration: a toast shown with `celebrate` carries the attribute that runs the spark animation,
// any other toast clears it, and reduced motion turns the animation off in CSS.
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { TOAST_RUNTIME_JS } from "../../src/ui-library/runtime/toast.ts";
import { renderToastRegion, TOAST_CSS } from "../../src/ui-library/components/toast.ts";

const attributes = new Set<string>();
const region = {
  hidden: true, dataset: {} as Record<string, string>, offsetWidth: 0,
  querySelector: () => ({ textContent: "", addEventListener() {} }), querySelectorAll: () => [], addEventListener() {}, contains: () => false,
  setAttribute: (name: string) => attributes.add(name), removeAttribute: (name: string) => attributes.delete(name),
};
const context: Record<string, unknown> = { region, performance: { now: () => 0 }, setTimeout: () => 1, clearTimeout() {}, queueMicrotask() {}, document: { hidden: false, addEventListener() {} } };
context.globalThis = context;
runInNewContext(`${TOAST_RUNTIME_JS};globalThis.toast=createKuramiToast(region,()=>null);`, context);
const toast = context.toast as { show: (text: string, options: Record<string, unknown>) => void };
toast.show("PR merged", { tone: "success", celebrate: true });
assert.ok(attributes.has("data-celebrate"));
toast.show("Saved", { tone: "success" });
assert.ok(!attributes.has("data-celebrate"), "an ordinary notice does not celebrate");
assert.match(TOAST_CSS, /@media \(prefers-reduced-motion: reduce\) \{ \.toast\[data-celebrate\] \.toast__icon, \.toast\[data-celebrate\] \.toast__icon::after, \.toast\[data-celebrate\] \.toast__kurami \{ animation: none; \} \}/);
// Projects brings Kurami herself to a celebrated notice; other apps keep the plain toast.
assert.match(renderToastRegion("Close", { kurami: true }), /<span class="toast__kurami" aria-hidden="true"><span class="kurami-mood" data-kurami-mood="celebrate"/);
assert.doesNotMatch(renderToastRegion("Close"), /toast__kurami/);
// Kurami sits inside the toast in place of the icon (nothing covers the page); switched off, the icon returns.
assert.match(TOAST_CSS, /\.toast\[data-celebrate\] > \.toast__kurami \{ display: block;/);
assert.match(TOAST_CSS, /\.toast\[data-celebrate\]:has\(> \.toast__kurami\) > \.toast__icon \{ display: none; \}/);
assert.match(TOAST_CSS, /html\[data-kurami-mascot="off"\] \.toast\[data-celebrate\]:has\(> \.toast__kurami\) > \.toast__icon \{ display: grid; \}/);
assert.doesNotMatch(TOAST_CSS, /\.toast__kurami \{[^}]*position: absolute/, "Kurami is not drawn over the page");
console.log(JSON.stringify({ ok: true, toastCelebrate: "flag on, flag cleared, reduced motion, Kurami on Projects" }));
