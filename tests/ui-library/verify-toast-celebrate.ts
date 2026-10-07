// Completion celebration: a toast shown with `celebrate` carries the attribute that runs the spark animation,
// any other toast clears it, and reduced motion turns the animation off in CSS.
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { TOAST_RUNTIME_JS } from "../../src/ui-library/runtime/toast.ts";
import { TOAST_CSS } from "../../src/ui-library/components/toast.ts";

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
assert.match(TOAST_CSS, /@media \(prefers-reduced-motion: reduce\) \{ \.toast\[data-celebrate\] \.toast__icon, \.toast\[data-celebrate\] \.toast__icon::after \{ animation: none; \} \}/);
console.log(JSON.stringify({ ok: true, toastCelebrate: "flag on, flag cleared, reduced motion" }));
