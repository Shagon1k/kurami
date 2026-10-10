// Kurami's moods: every illustration exists and is a small WebP, the component renders it decoratively and
// lazily, the flat asset paths pass the gateway's mounted-asset rule, every app serves them, the owner can
// switch Kurami off for all apps, the Hub pulse picks the right mood, the Daily finish counts reading time
// and marks the edition read, and every phrase exists in both languages.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { KURAMI_MASCOT_RUNTIME_JS, KURAMI_MOODS, KURAMI_MOOD_CSS, KURAMI_PULL_REFRESH_JS, kuramiMoodAssets, kuramiMoodPath, renderKuramiMood, renderKuramiState } from "../../src/ui-library/components/kurami-mood.ts";
import { THEME_RUNTIME_JS } from "../../src/ui-library/runtime/theme.ts";
import { resolveWebRoute } from "../../src/web/routes.ts";
import { mascotCookie } from "../../src/web/server.ts";
import { createHubServer } from "../../src/hub/server.ts";
import { pulseMood, renderHubDashboard } from "../../src/hub/render.ts";
import { syntheticHubSnapshot } from "../../src/ui-library/testing/fixtures.ts";
import { readingMinutes, renderDailyFinish } from "../../src/briefing/ui/components/daily-finish.ts";
import { syntheticDailyFilledPayload } from "../../src/ui-library/testing/digest-filled.ts";
import { withDigestLanguage } from "../../src/briefing/i18n.ts";
import { readMascotEnabled, runAppearanceSettingsCli } from "../../src/system/appearance/appearance-settings.ts";
import type { AddressInfo } from "node:net";

// Assets: twelve moods, each a lossless WebP (exact transparency) under 110 KB, at flat paths the gateway accepts for a mounted app.
assert.equal(KURAMI_MOODS.length, 12);
for (const asset of kuramiMoodAssets()) {
  if(asset.type==="image/webp"){
    assert.ok(asset.body.subarray(0, 4).toString() === "RIFF" && asset.body.subarray(8, 12).toString() === "WEBP", `${asset.path} is WebP`);
    assert.ok(asset.body.length < 110_000, `${asset.path} stays small`);
  }else{
    assert.equal(asset.type,"image/png");assert.equal(asset.body.subarray(1,4).toString(),"PNG");
    assert.equal(asset.body.readUInt32BE(16),1024);assert.equal(asset.body.readUInt32BE(20),1024);
  }
  assert.ok(resolveWebRoute(`/_apps/hub${asset.path}`), `${asset.path} passes the gateway`);
}
assert.equal(kuramiMoodPath("done"), "/assets/kurami-done.webp");

// Component: decorative and lazy by default, labelled when asked, bounded sizes.
// Medallion: a decorative span with the ring and the figure, lazy by default, labelled when asked.
const idle = renderKuramiMood({ mood: "idle" });
assert.match(idle, /^<span class="kurami-mood" data-kurami-mood="idle" aria-hidden="true"><svg class="kurami-mood__ring"/);
assert.match(idle, /<img class="kurami-mood__figure" src="\/assets\/kurami-idle\.webp" srcset="[^\"]+320w, [^\"]+1024w" sizes="[^\"]+" width="160" height="160" alt="" loading="lazy" decoding="async"><\/span>$/);
assert.match(renderKuramiMood({ mood: "welcome", label: "Kurami <waves>", eager: true }), /role="img" aria-label="Kurami &lt;waves&gt;"[\s\S]*loading="eager"/);
assert.throws(() => renderKuramiMood({ mood: "angry" as never }));
// The cut is only along the lower arc (the top band stays unmasked); motion has a reduced-motion guard.
assert.match(KURAMI_MOOD_CSS, /linear-gradient\(#000 0 55%, transparent 57%\), radial-gradient\(37% 37% at 50% 48%, #000 99%, transparent 100%\)/);
assert.match(KURAMI_MOOD_CSS, /@media \(prefers-reduced-motion: no-preference\) \{/);
assert.match(renderKuramiState({ mood: "offline", title: "No <net>", text: "Wait", headingLevel: 1 }), /<h1>No &lt;net&gt;<\/h1><p>Wait<\/p>/);

// Switching Kurami off: the gateway cookie, the runtime mark before paint, CSS that hides every picture.
assert.match(mascotCookie(false, true), /^kurami-mascot=off; Max-Age=31536000; Path=\/; SameSite=Lax; Secure$/);
assert.match(mascotCookie(true, false), /^kurami-mascot=; Max-Age=0;/);
for (const [cookie, expected] of [["a=1; kurami-mascot=off", "off"], ["kurami-mascot=", "on"], ["", "on"]] as const) {
  const root = { dataset: {} as Record<string, string> };
  runInNewContext(KURAMI_MASCOT_RUNTIME_JS, { document: { cookie, documentElement: root } });
  assert.equal(root.dataset.kuramiMascot, expected);
}
assert.match(KURAMI_MOOD_CSS, /html\[data-kurami-mascot="off"\] \.kurami-mood \{ display: none; \}/);
assert.ok(THEME_RUNTIME_JS.includes(KURAMI_MASCOT_RUNTIME_JS) && THEME_RUNTIME_JS.includes(KURAMI_PULL_REFRESH_JS), "every app's theme runtime carries the switch and pull-to-refresh");
assert.match(KURAMI_PULL_REFRESH_JS, /display-mode: standalone/, "pull-to-refresh only where the browser has none");

const home = mkdtempSync(join(tmpdir(), "kurami-moods-")), previousHome = process.env.KURAMI_HOME;
try {
  process.env.KURAMI_HOME = home;
  assert.equal(readMascotEnabled(), true, "on by default");
  await runAppearanceSettingsCli(["apply", "--theme", "paper", "--mode", "light", "--mascot", "off", "--expected-revision", "0", "--actor-id", "1"]);
  assert.equal(readMascotEnabled(), false);
  assert.equal((await runAppearanceSettingsCli(["apply", "--theme", "paper", "--mode", "light", "--expected-revision", "1", "--actor-id", "1"])).action, "unchanged", "an apply without --mascot keeps it");
  await assert.rejects(runAppearanceSettingsCli(["apply", "--theme", "paper", "--mode", "light", "--mascot", "maybe", "--expected-revision", "1", "--actor-id", "1"]), /on or off/);
} finally { if (previousHome === undefined) delete process.env.KURAMI_HOME; else process.env.KURAMI_HOME = previousHome; rmSync(home, { recursive: true, force: true }); }

// Hub serves the pictures itself, and the pulse picks Kurami's mood from what matters most.
const hub = createHubServer({ snapshot: syntheticHubSnapshot, authorize: async () => "owner" });
await new Promise<void>(done => hub.listen(0, "127.0.0.1", done));
try {
  const response = await fetch(`http://127.0.0.1:${(hub.address() as AddressInfo).port}/assets/kurami-peek.webp`);
  assert.equal(response.status, 200); assert.equal(response.headers.get("content-type"), "image/webp");
} finally { hub.close(); }
const quiet = syntheticHubSnapshot(); quiet.operations!.alerts = []; quiet.totals = { ...quiet.totals, working: 0, attention: 0 };
quiet.generatedAt = "2026-10-07T10:00:00Z"; assert.equal(pulseMood(quiet), "idle");
quiet.generatedAt = "2026-10-07T22:30:00Z"; assert.equal(pulseMood(quiet), "asleep", "01:30 in the edition's zone");
quiet.totals.working = 2; assert.equal(pulseMood(quiet), "working");
quiet.totals.attention = 1; assert.equal(pulseMood(quiet), "needs-decision");
assert.match(renderHubDashboard({ ...syntheticHubSnapshot(), digestReadAt: "2026-09-16T05:05:00Z" }, "ru"), /<span>Дайджест ✓ 08:05<\/span>/);

// Daily finish: completion only, with no reading estimate or story count at the bottom.
const payload = syntheticDailyFilledPayload();
assert.ok(readingMinutes(payload) >= 1);
const ru = withDigestLanguage("ru", () => renderDailyFinish(payload)), en = withDigestLanguage("en", () => renderDailyFinish(payload));
assert.match(ru, /<h2 id="daily-finish-heading">Всё\. Ты в курсе\.<\/h2>/);
assert.doesNotMatch(ru, /мин чтения|6 сюжетов/);
assert.match(en, /<h2 id="daily-finish-heading">That's all\. You're up to date\.<\/h2>/);
assert.doesNotMatch(en, /min read|6 stories/);
assert.match(en, /data-kurami-mood="done"/);

// Every Kurami phrase added for the moods has an English twin in the code that renders it.
const sources = ["src/hub/render.ts", "src/briefing/server.ts", "src/projects-site/i18n.ts", "src/web/sw.js", "src/hub/control-view.ts"].map(path => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")).join("\n");
for (const [russian, english] of [["Hub вернётся, как только появится сеть", "Hub comes back as soon as the network does"], ["Kurami собирает выпуск", "Kurami is putting the edition together"],
  ["Тебя никто не ждёт", "Nothing is waiting for you"], ["Kurami ждёт сеть", "Kurami is waiting for the network"], ["Персонаж Kurami", "Kurami character"]] as const)
  assert.ok(sources.includes(russian) && sources.includes(english), `${russian} has its English version`);
assert.ok(statSync(new URL("../../src/ui-library/assets/kurami/peek.webp", import.meta.url)).size > 0);
console.log(JSON.stringify({ ok: true, kuramiMoods: "assets, component, gateway paths, mascot switch, Hub serving and pulse, Daily finish, both languages" }));
