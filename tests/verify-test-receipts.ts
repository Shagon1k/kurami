// Regression receipts: keyed by tree, a changed-only pass never hides a full one, a failure replaces a pass,
// the GitHub repository is read from the origin URL, and the status text stays within GitHub's limit.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { githubRepository, passedFull, readReceipt, statusDescription, writeReceipt, type TestReceipt } from "../src/system/test-receipts.ts";

const home = mkdtempSync(join(tmpdir(), "kurami-receipts-")), tree = "a".repeat(40);
const receipt = (patch: Partial<TestReceipt>): TestReceipt => ({ tree, commit: "b".repeat(40), scope: "full", ok: true, suites: 100, failedSuites: [], durationMs: 290_000, at: "2026-10-06T10:00:00.000Z", ...patch });
try {
  assert.equal(await passedFull(home, tree), null);
  assert.equal(await readReceipt(home, "../etc"), null, "only tree hashes are read");
  await writeReceipt(home, receipt({}));
  assert.equal((await passedFull(home, tree))?.suites, 100);
  await writeReceipt(home, receipt({ scope: "changed", suites: 7 }));
  assert.equal((await passedFull(home, tree))?.suites, 100, "a changed-only pass keeps the full receipt");
  await writeReceipt(home, receipt({ scope: "changed", ok: false, failedSuites: ["test:hub"] }));
  assert.equal(await passedFull(home, tree), null, "a failure of the same tree replaces the pass");

  assert.equal(githubRepository("https://github.com/Shagon1k/kurami.git\n"), "Shagon1k/kurami");
  assert.equal(githubRepository("git@github.com:Shagon1k/kurami.git"), "Shagon1k/kurami");
  assert.equal(githubRepository("https://example.com/x/y.git"), null);
  assert.equal(statusDescription(receipt({})), "All: 100 suites passed in 5 min on the server");
  assert.ok(statusDescription(receipt({ ok: false, failedSuites: Array.from({ length: 40 }, (_, index) => `test:suite-${index}`) })).length <= 140);
  console.log(JSON.stringify({ ok: true, receipts: "tree keys, full over changed, failure replaces, repository, status text" }));
} finally { rmSync(home, { recursive: true, force: true }); }
