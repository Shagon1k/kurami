import { spawnSync } from "node:child_process";

const suites = [
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
  "test:release",
  "test:preview-slots",
  "test:preview-ingress",
  "test:preview-ttl",
  "test:preview-reviewed",
  "test:preview-policy",
  "test:preview-static",
  "test:controls",
  "test:observer",
  "test:discord",
  "test:discord-plugin",
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
  "test:session-start",
  "test:session-handoff",
  "test:autonomous-successor",
  "test:cancel-resolution",
  "test:project-status",
  "test:ci",
  "test:ci-repair",
  "test:ai-review",
  "test:project-resilience",
  "test:review-fix",
  "test:managed-task-recovery",
  "test:triage-snapshot",
  "test:projects-digest",
  "test:metadata-proposals",
  "test:metadata-owner-review",
  "test:metadata-sync",
  "test:metadata-scheduler",
] as const;

const startedAt = Date.now();
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

for (const suite of suites) {
  process.stdout.write(`\n=== ${suite} ===\n`);
  const result = spawnSync(npm, ["run", suite], {
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.stderr.write(
      `${JSON.stringify({ ok: false, failedSuite: suite, exitCode: result.status })}\n`,
    );
    process.exit(result.status ?? 1);
  }
}

process.stdout.write(
  `${JSON.stringify({ ok: true, suites: suites.length, durationMs: Date.now() - startedAt })}\n`,
);
