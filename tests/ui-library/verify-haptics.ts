// Haptics runtime: vibrates only on a coarse pointer without reduced motion; a primary button taps, an
// opted-in control uses its own pattern, `data-haptic="off"` and disabled controls stay silent, and toasts
// pulse for success and buzz for warnings. Runs the shipped script against stub browser globals.
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { HAPTIC_PATTERNS, HAPTICS_RUNTIME_JS } from "../../src/ui-library/runtime/haptics.ts";
import { TOAST_RUNTIME_JS } from "../../src/ui-library/runtime/toast.ts";
import { WEB_CLIENT_JS } from "../../src/web/presentation.ts";

assert.ok(WEB_CLIENT_JS.includes(HAPTICS_RUNTIME_JS), "every app's shared client carries the runtime");

// The script runs in its own realm: compare its arrays by value.
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));

class Element {
  dataset: Record<string, string>; parent: Element | null; classes: string[]; disabled: boolean;
  constructor(classes: string[], dataset: Record<string, string> = {}, parent: Element | null = null, disabled = false) { this.classes = classes; this.dataset = dataset; this.parent = parent; this.disabled = disabled; }
  matches(selector: string): boolean {
    return selector.split(",").some(part => {
      part = part.trim();
      if (part === ".button--primary") return this.classes.includes("button--primary");
      if (part === "[data-haptic]") return "haptic" in this.dataset;
      if (part === '[data-haptic="off"]') return this.dataset.haptic === "off";
      if (part === ":disabled") return this.disabled;
      return false;
    });
  }
  closest(selector: string): Element | null { for (let node: Element | null = this; node; node = node.parent) if (node.matches(selector)) return node; return null; }
}

function page(options: { coarse?: boolean; reduced?: boolean; vibrate?: boolean } = {}) {
  const calls: unknown[] = [];
  let click: ((event: { target: unknown }) => void) | undefined;
  const context: Record<string, unknown> = {
    Element,
    navigator: options.vibrate === false ? {} : { vibrate: (pattern: unknown) => { calls.push(pattern); return true; } },
    matchMedia: (query: string) => ({ matches: query.includes("coarse") ? options.coarse ?? true : options.reduced ?? false }),
    document: { addEventListener: (type: string, listener: typeof click) => { if (type === "click") click = listener; } },
  };
  context.window = context; context.globalThis = context;
  runInNewContext(HAPTICS_RUNTIME_JS, context);
  return { calls, click: (target: Element) => click!({ target }), haptic: (kind: string) => (context.kuramiHaptic as (kind: string) => boolean)(kind), context };
}

const phone = page();
phone.click(new Element(["button", "button--primary"]));
phone.click(new Element(["button__label"], {}, new Element(["button", "button--primary"])));
phone.click(new Element(["button", "button--subtle"]));
phone.click(new Element(["button"], { haptic: "confirm" }));
phone.click(new Element(["button", "button--primary"], {}, new Element(["panel"], { haptic: "off" })));
phone.click(new Element(["button", "button--primary"], {}, null, true));
assert.deepEqual(plain(phone.calls), [HAPTIC_PATTERNS.tap, HAPTIC_PATTERNS.tap, HAPTIC_PATTERNS.confirm], "primary taps, opted-in confirm; subtle, off and disabled stay silent");

for (const options of [{ coarse: false }, { reduced: true }, { vibrate: false }]) {
  const quiet = page(options);
  quiet.click(new Element(["button", "button--primary"]));
  assert.equal(quiet.haptic("success"), false);
  assert.deepEqual(quiet.calls, [], `no vibration with ${JSON.stringify(options)}`);
}

// Toasts call the global helper by tone; info stays silent.
const toastPage = page();
const region = { hidden: true, dataset: {} as Record<string, string>, setAttribute() {}, removeAttribute() {}, querySelector: () => ({ textContent: "", addEventListener() {} }), querySelectorAll: () => [], addEventListener() {}, contains: () => false };
Object.assign(toastPage.context, { performance: { now: () => 0 }, setTimeout: () => 1, clearTimeout() {}, queueMicrotask() {} });
(toastPage.context.document as Record<string, unknown>).hidden = false;
runInNewContext(`${TOAST_RUNTIME_JS};globalThis.toast=createKuramiToast(region,()=>null);`, Object.assign(toastPage.context, { region }));
const toast = toastPage.context.toast as { show: (text: string, options: { tone: string }) => void };
toast.show("saved", { tone: "success" }); toast.show("note", { tone: "info" }); toast.show("broken", { tone: "failure" });
assert.deepEqual(plain(toastPage.calls), [HAPTIC_PATTERNS.success, HAPTIC_PATTERNS.failure]);
console.log(JSON.stringify({ ok: true, haptics: "primary tap, opt-in, opt-out, disabled, device gates, toast tones" }));
