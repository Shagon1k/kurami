import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, chmod, writeFile } from "node:fs/promises";
import { resolve, relative, dirname } from "node:path";
import { DatabaseSync, backup } from "node:sqlite";
import { briefingPaths, type BriefingPaths } from "../store.ts";
import { upgradeLegacyPayload } from "./addon-format.ts";

type Row = { id: string; payload_json: string; html_path: string; content_digest: string };
export async function migrateStoredAddonFormat(paths: BriefingPaths, apply = false) {
  const db = new DatabaseSync(paths.databasePath, { readOnly: !apply, timeout: 5000 });
  try {
    const rows = db.prepare("SELECT id, payload_json, html_path, content_digest FROM editions ORDER BY id").all() as Row[];
    const plans = [];
    for (const row of rows) {
      const original = JSON.parse(row.payload_json);
      const payload = upgradeLegacyPayload(original);
      if (original.formatVersion === 3) continue;
      const htmlPath = resolve(paths.stateDirectory, row.html_path);
      const child = relative(paths.pagesDirectory, htmlPath);
      if (child.startsWith("..") || resolve(paths.pagesDirectory, child) !== htmlPath) throw new Error("Unsafe stored HTML path");
      const html = await readFile(htmlPath, "utf8");
      const json = JSON.stringify(payload);
      plans.push({ ...row, json, digest: createHash("sha256").update(json).update("\0").update(html).digest("hex") });
    }
    const summary = { checked: rows.length, converted: plans.length, ids: plans.map(row => row.id) };
    if (!apply || !plans.length) return { ok: true, applied: false, ...summary };
    const active = db.prepare(`SELECT COUNT(*) AS count FROM briefing_run_attempts
      WHERE state NOT IN ('notified','failed') AND updated_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day')`).get() as { count: number };
    if (active.count) throw new Error("Stop or finish active briefing attempts before migration");
    await mkdir(paths.recoveryDirectory, { recursive: true, mode: 0o700 });
    const directory = await mkdtemp(resolve(paths.recoveryDirectory, "addon-format-backup-"));
    const backupPath = resolve(directory, "briefing.db");
    await backup(db, backupPath);
    await chmod(backupPath, 0o600);
    db.exec("BEGIN IMMEDIATE");
    try {
      const current = db.prepare("SELECT id, payload_json, html_path, content_digest FROM editions ORDER BY id").all();
      if (JSON.stringify(current) !== JSON.stringify(rows)) throw new Error("Briefing state changed during migration; retry while writers are stopped");
      const update = db.prepare("UPDATE editions SET payload_json=?, content_digest=? WHERE id=? AND content_digest=?");
      for (const row of plans) {
        if (update.run(row.json, row.digest, row.id, row.content_digest).changes !== 1) throw new Error("Migration lost edition lock");
      }
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
    return { ok: true, applied: true, ...summary, backupPath };
  } finally { db.close(); }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const inputIndex = args.indexOf("--input");
  const outputIndex = args.indexOf("--output");
  try {
    const allowed = new Set(["--apply", "--input", "--output"]);
    for (let i=0; i<args.length; i++) {
      if (!allowed.has(args[i]!)) throw new Error("Unsupported migration argument");
      if (args[i] !== "--apply") {
        if (!args[++i] || args[i]!.startsWith("--")) throw new Error("Missing migration path");
      }
    }
    if (inputIndex >= 0) {
      if (outputIndex < 0 || apply) throw new Error("File import requires --input and --output; no --apply");
      const input = resolve(args[inputIndex + 1]!);
      const output = resolve(args[outputIndex + 1]!);
      if (input === output) throw new Error("File import must preserve the original input");
      const payload = upgradeLegacyPayload(JSON.parse(await readFile(input, "utf8")));
      await mkdir(dirname(output), { recursive: true, mode: 0o700 });
      await writeFile(output, JSON.stringify(payload, null, 2) + "\n", { mode: 0o600, flag: "wx" });
      process.stdout.write(JSON.stringify({ok:true, output}) + "\n");
    } else {
      if (outputIndex >= 0) throw new Error("--output requires --input");
      process.stdout.write(JSON.stringify(await migrateStoredAddonFormat(briefingPaths(), apply)) + "\n");
    }
  } catch (error) {
    process.stderr.write(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }) + "\n");
    process.exitCode = 1;
  }
}
