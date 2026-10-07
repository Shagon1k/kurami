// Brand moments: the season by local date, the birthday wins over the season, every app's shared runtime and
// header CSS carry them, and the sneeze respects reduced motion.
import assert from "node:assert/strict";
import { BRAND_MOMENTS_CSS, BRAND_MOMENTS_RUNTIME_JS, brandMoment } from "../../src/ui-library/runtime/brand-moments.ts";
import { THEME_RUNTIME_JS } from "../../src/ui-library/runtime/theme.ts";
import { SITE_HEADER_CSS } from "../../src/ui-library/patterns/site-header.ts";

const at = (value: string) => brandMoment(new Date(`${value}T12:00:00`));
assert.deepEqual(["2026-12-01", "2027-01-31", "2026-10-07", "2026-08-16", "2026-02-01", "2026-11-30", "2026-09-30"].map(at), ["winter", "winter", "autumn", "birthday", null, null, null]);
assert.ok(THEME_RUNTIME_JS.includes(BRAND_MOMENTS_RUNTIME_JS), "every app's theme runtime carries the brand moments");
assert.ok(SITE_HEADER_CSS.includes(BRAND_MOMENTS_CSS));
assert.match(BRAND_MOMENTS_CSS, /@media \(prefers-reduced-motion: reduce\) \{ \.site-brand\.ui-sneeze \.site-brand__fox \{ animation: none; \} \}/);
assert.doesNotMatch(BRAND_MOMENTS_RUNTIME_JS, /BRAND_BIRTHDAY/, "the birthday is inlined into the browser script");
console.log(JSON.stringify({ ok: true, brandMoments: "seasons, birthday, shared runtime, reduced motion" }));
