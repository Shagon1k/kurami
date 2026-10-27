// Kurami regression runner. `npm test` runs every suite; `npm run test:changed` runs only the suites a change
// touches (tests/test-plan.ts); `--only=a,b` runs the named ones. "check" and "test:docs" run first, the rest
// in a pool sized by Hub → Controls → Server → Development resources (KURAMI_TEST_JOBS overrides), and
// browser suites last, one at a time. The whole run lives in kurami-dev.slice at low priority. A run of the
// whole or the changed set records which tree it tested and reports it on GitHub (src/system/test-receipts.ts).
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveKuramiHome } from "../src/core/kurami-home.ts";
import { readDevResources } from "../src/system/dev-resources/dev-resources.ts";
import { changedFiles, planSuites, registeredSuites } from "./test-plan.ts";
import { reportStatus, workingTree, writeReceipt, type TestReceipt } from "../src/system/test-receipts.ts";

const root = resolve(import.meta.dirname, "..");
if (process.env.KURAMI_DEV_SLICE !== "1") {
  const result = spawnSync(resolve(root, "bin/kurami-dev-run"), [process.execPath, ...process.argv.slice(1)], { stdio: "inherit" });
  process.exit(result.status ?? 1);
}

const suites = [
  "test:duplication-refactor",
  "test:investment-review",
  "test:briefing-company-logos",
  "test:briefing-discovery",
  "test:briefing-stocks",
  "test:briefing-header",
  "test:ui-library",
  "test:ui-guard",
  "test:hub",
  "test:resource-audit",
  "test:projects-site",
  "test:web",
  "test:briefing-weekly",
  "test:briefing-completion",
  "test:briefing-charts",
  "test:briefing-signals",
  "test:briefing-interest",
  "test:briefing-format",
  "test:briefing-addons",
  "test:skills",
  "test:telegram-wrapper",
  "test:briefing-runtime",
  "test:briefing-http",
  "test:briefing-mail-ui",
  "test:briefing-providers",
  "test:briefing-editorial",
  "test:briefing-poller",
  "test:briefing-workflow",
  "test:briefing-cinema",
  "test:admission",
  "test:provision",
  "test:sqlite-locks",
  "test:test-plan",
  "test:projects-registry",
  "test:forecasts",
  "test:digest-run-card",
  "test:digest-engineering",
  "test:push",
  "test:toast-celebrate",
  "test:haptics",
  "test:brand-moments",
  "test:offline-news",
  "test:autopilot",
  "test:hero-mood",
  "test:mail-learning",
  "test:capture",
  "test:kurami-status",
  "test:chronicle",
  "test:kurami-moods",
  "test:ideas",
  "test:quick-capture",
  "test:release",
  "test:lifecycle-feedback",
  "test:preview-slots",
  "test:preview-ingress",
  "test:preview-ttl",
  "test:preview-reviewed",
  "test:preview-policy",
  "test:preview-static",
  "test:controls",
  "test:controller-planning",
  "test:observer",
  "test:discord",
  "test:discord-plugin",
  "test:docs-approval",
  "test:appearance",
  "test:dev-resources",
  "test:controller-failures",
  "test:log-rotation",
  "test:deploy",
  "test:receipts",
  "test:release-drift",
  "test:backup",
  "test:recovery",
  "test:s3-recovery",
  "test:adversarial",
  "test:runtime-settings",
  "test:project-readiness",
  "test:runtime-health",
  "test:server-health",
  "test:cpu-statistics",
  "test:system-health-discord",
  "test:health-cycle",
  "test:network-health",
  "test:health-settings",
  "test:kurami-home",
  "test:composio-session",
  "test:composio-hermes",
  "test:resource-guard",
  "test:resource-guard-discord",
  "test:maintenance",
  "test:runtime-budget",
  "test:session-cancel",
  "test:codex-protocol",
  "test:legacy-ci-timeout-recovery",
  "test:ci-no-head-recovery",
  "test:external-ci-delivery-recovery",
  "test:session-start",
  "test:session-handoff",
  "test:autonomous-successor",
  "test:autonomous-completion",
  "test:cancel-resolution",
  "test:project-status",
  "test:project-status-read-model",
  "test:project-usage",
  "test:api-equivalent",
  "test:ci",
  "test:ci-repair",
  "test:worker-diagnostics",
  "test:ai-review",
  "test:project-resilience",
  "test:review-fix",
  "test:owner-decision",
  "test:managed-source-refresh",
  "test:managed-task-recovery",
  "test:interrupted-review-fix-recovery",
  "test:triage-snapshot",
  "test:projects-digest",
  "test:metadata-proposals",
  "test:metadata-owner-review",
  "test:metadata-sync",
  "test:metadata-scheduler",
] as const;

/** Run before the pool: the type check gates everything, and the docs build feeds later suites. */
const first = ["check", "test:docs"] as const;
/** Chrome is heavy: browser suites run after the pool, one at a time. */
const browser = new Set(["test:hub-browser", "test:web-browser", "test:mobile-navigation", "test:ui-browser", "test:ui-browser:quick", "test:ui-browser:all"]);
/** The slowest suites start first, so the pool does not end waiting on one of them. */
const slow = ["test:codex-protocol", "test:docs-approval", "test:external-ci-delivery-recovery", "test:discord", "test:ci-no-head-recovery", "test:managed-task-recovery", "test:review-fix", "test:projects-site"];

const args = process.argv.slice(2);
const only = args.find(arg => arg.startsWith("--only="))?.slice(7).split(",").filter(Boolean);
const changedMode = args.includes("--changed");
/** Screenshot pages for the quick browser check: only the touched apps' pages, or all of them. */
function quickPages(changed: string[]): string | undefined {
  const products: [string, string][] = [["src/hub/", "hub-"], ["src/briefing/", "digest-"], ["src/projects-site/", "projects-"], ["src/human-docs/", "docs-"]];
  const prefixes = new Set<string>();
  for (const file of changed) {
    const product = products.find(([path]) => file.startsWith(path));
    if (product) prefixes.add(product[1]);
    else if (/^(src|tests\/ui-library)\//.test(file)) return undefined;
  }
  if (!prefixes.size) return undefined;
  const pages = [...readFileSync(resolve(root, "src/ui-library/testing/visual-regression.ts"), "utf8").matchAll(/^\s*"([a-z0-9-]+)":"\//gm)].map(match => match[1]!);
  return pages.filter(page => [...prefixes].some(prefix => page.startsWith(prefix))).join(",") || undefined;
}
const suiteEnv: Record<string, NodeJS.ProcessEnv> = {};
let selected: string[];
if (only) selected = only;
else if (changedMode) {
  // Registering a suite (a test:* script, a line in the list below) does not rerun every suite.
  const registration = registeredSuites(changedFiles());
  const changed = registration.changed;
  // A change that touches the browser check runs its quick variant (the touched apps' pages when the change
  // stays inside products); the full audit and the library-wide checks are for releases.
  const plan = planSuites([...first.slice(1), ...suites, "test:hub-browser", "test:web-browser", "test:mobile-navigation", "test:ui-browser"], changed);
  for (const suite of registration.added) if (!plan.suites.includes(suite) && (suites as readonly string[]).includes(suite)) { plan.suites.push(suite); plan.reasons[suite] = "newly registered"; }
  selected = plan.suites.map(suite => suite === "test:ui-browser" ? "test:ui-browser:quick" : suite);
  const pages = quickPages(changed);
  if (pages && selected.includes("test:ui-browser:quick")) {
    suiteEnv["test:ui-browser:quick"] = { ...process.env, KURAMI_UI_PAGES: pages };
    process.stdout.write(`  quick browser check: ${pages.split(",").length} page(s) of the touched apps\n`);
  }
  process.stdout.write(`${changed.length} changed file(s)${plan.everything ? ` — ${plan.reasons[plan.suites[0]!]} changes every suite` : ""}\n`);
  for (const suite of plan.suites) process.stdout.write(`  ${suite}  ← ${plan.reasons[suite]}\n`);
} else selected = [...first, ...suites];
if (!selected.includes("check")) selected.unshift("check");

// The tree under test, for the receipt; a run of hand-picked suites records nothing.
const testedTree = only ? null : workingTree(root);
const jobs = Math.max(1, Number(process.env.KURAMI_TEST_JOBS) || readDevResources().testJobs);
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const startedAt = Date.now();
const durations: Record<string, number> = {};
const failed: string[] = [];

/** Runs one suite with its output buffered; prints it whole when the suite fails, one line when it passes. */
function runSuite(suite: string): Promise<boolean> {
  return new Promise(done => {
    const started = Date.now(), output: Buffer[] = [];
    const child = spawn(npm, ["run", "-s", suite], { env: suiteEnv[suite] ?? process.env, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", chunk => output.push(chunk));
    child.stderr.on("data", chunk => output.push(chunk));
    child.on("close", code => {
      durations[suite] = (Date.now() - started) / 1000;
      if (code === 0) process.stdout.write(`ok   ${suite} (${durations[suite]!.toFixed(1)}s)\n`);
      else { failed.push(suite); process.stdout.write(`\nFAIL ${suite} (exit ${code})\n${Buffer.concat(output).toString()}\n`); }
      done(code === 0);
    });
  });
}

async function pool(list: string[], size: number): Promise<void> {
  const queue = [...list];
  await Promise.all(Array.from({ length: Math.min(size, queue.length) }, async () => {
    while (queue.length && !failed.length) await runSuite(queue.shift()!);
  }));
}

process.stdout.write(`${selected.length} suite(s), ${jobs} job(s)\n`);
for (const suite of first) if (selected.includes(suite) && !failed.length) await runSuite(suite);
const rest = selected.filter(suite => !(first as readonly string[]).includes(suite) && !browser.has(suite));
rest.sort((a, b) => (slow.indexOf(a) + 1 || 99) - (slow.indexOf(b) + 1 || 99));
await pool(rest, jobs);
for (const suite of selected.filter(suite => browser.has(suite))) if (!failed.length) await runSuite(suite);

const durationMs = Date.now() - startedAt;
await recordRun(!failed.length, durationMs);
if (failed.length) {
  process.stderr.write(`${JSON.stringify({ ok: false, failedSuites: failed, durationMs })}\n`);
  process.exit(1);
}
process.stdout.write(`${JSON.stringify({ ok: true, suites: selected.length, jobs, durationMs })}\n`);

/** Records which tree passed (or failed) and, when that tree is the commit at HEAD, reports it on GitHub.
 * Files edited during the run make the result unattributable, so nothing is recorded then. */
async function recordRun(ok: boolean, durationMs: number): Promise<void> {
  if (!testedTree || workingTree(root) !== testedTree) return;
  const head = (spec: string) => spawnSync("git", ["rev-parse", spec], { cwd: root, encoding: "utf8" }).stdout.trim();
  const receipt: TestReceipt = {
    tree: testedTree, commit: head("HEAD"), scope: changedMode ? "changed" : "full", ok,
    suites: selected.length, failedSuites: failed, durationMs, at: new Date().toISOString(),
  };
  try { await writeReceipt(resolveKuramiHome("/home/shagon1k/_hermes/_kurami"), receipt); } catch { return; }
  if (head("HEAD^{tree}") === testedTree && process.env.KURAMI_TEST_STATUS !== "0") process.stdout.write(`${await reportStatus(root, receipt)}\n`);
}
