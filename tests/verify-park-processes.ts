import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";


const home = mkdtempSync(join(tmpdir(), "kurami-park-tree-"));
process.env.KURAMI_HOME = home;
const bin = join(home, "bin"); mkdirSync(bin);
process.env.PATH = `${bin}:${process.env.PATH}`;
const { descendantProcesses, cleanupParkProcesses, loadParkProcesses, saveParkProcesses } = await import("../src/orchestrator/projects/sessions/park-processes.ts");
const { leaveCliSession } = await import("../src/orchestrator/projects/sessions/session-stop.ts");
const { loadRun } = await import("../src/orchestrator/projects/sessions/session-shared.ts");
const trees: ReturnType<typeof spawn>[] = [];
const captured: ReturnType<typeof descendantProcesses>[] = [];
const delay = () => new Promise(resolve => setTimeout(resolve, 25));
writeFileSync(join(home, "server.mjs"), `import {createServer} from 'node:net';import {writeFileSync,existsSync} from 'node:fs';
process.on('SIGTERM',()=>{if(!existsSync(process.argv[2]+'.block'))process.exit(0);});
const server=createServer();server.listen(0,'127.0.0.1',()=>writeFileSync(process.argv[2],JSON.stringify({pid:process.pid,port:server.address().port})));`);
writeFileSync(join(home, "root.mjs"), `import {spawn} from 'node:child_process';
spawn('/bin/bash',['-c','"$1" "$2" "$3" & wait','fixture',process.execPath,process.argv[2],process.argv[3]],{stdio:'ignore'});setInterval(()=>{},1000);`);
writeFileSync(join(bin, "tmux"), `#!/bin/sh
case "$1" in
has-session) test -f "$PARK_ALIVE" ;;
capture-pane) if test "$PARK_BUSY" = 1; then printf '%s\n' 'Working (4m - esc to interrupt)'; else printf '%s\n' 'Worked for 50s • 09:50' '' '› Ask Codex to do anything'; fi ;;
list-panes) printf '%s\n' "$PARK_ROOT" ;;
send-keys) case "$*" in *C-d*) kill -TERM "$PARK_ROOT"; /bin/rm -f "$PARK_ALIVE" ;; esac ;;
*) exit 64 ;;
esac\n`, { mode: 0o700 });

async function tree(name: string, stubborn = false) {
  const info = join(home, `${name}.json`);
  if (stubborn) writeFileSync(info + ".block", "1");
  const root = spawn(process.execPath, [join(home, "root.mjs"), join(home, "server.mjs"), info], { stdio: "ignore", cwd: home });
  trees.push(root);
  for (let i = 0; i < 120 && !existsSync(info); i++) await delay();
  assert.ok(existsSync(info), "real server became ready");
  const server = JSON.parse(readFileSync(info, "utf8")) as { pid: number; port: number };
  const processes = descendantProcesses([root.pid!]); captured.push(processes);
  assert.ok(processes.some(entry => entry.pid === server.pid));
  assert.ok(processes.length >= 3, "root -> bash -> actual listening node server");
  return { root, server, processes };
}
let database: DatabaseSync | undefined;
try {
  execFileSync("python3", [resolve(import.meta.dirname, "verify-park-pidfd.py")], { stdio: "inherit" });
  execFileSync(process.execPath, [resolve(import.meta.dirname, "../src/orchestrator/state/init-run-store.ts")], { env: { ...process.env, ORCHESTRATOR_MIGRATIONS_DIR: resolve(import.meta.dirname, "../migrations") }, stdio: "pipe" });
  database = new DatabaseSync(join(home, "state/orchestrator.db"));
  database.exec(`INSERT INTO project_events(event_id,observed_at,project,item_id,content_type,payload_json) VALUES('e','2026-10-12T00:00:00Z','fixture','item','Issue','{}');
    INSERT INTO runs(run_id,trigger_event_id,project,item_id,content_id,repository,issue_number,interaction_policy,state,owner_state,execution_mode) VALUES('r_fixture','e','fixture','item','content','Example/Fixture',1,'autonomous','running','cli','live');
    INSERT INTO run_resources(run_id,resource_state,worktree_path,branch_name,codex_thread_id,tmux_session_name) VALUES('r_fixture','provisioned','${home}','fixture','thread','cx-fixture');`);
  const unrelated = await tree("unrelated");
  const managed = await tree("managed");
  process.env.PARK_ROOT = String(managed.root.pid);
  process.env.PARK_ALIVE = join(home, "alive"); writeFileSync(process.env.PARK_ALIVE, "1");
  process.env.PARK_BUSY = "1";
  await assert.rejects(leaveCliSession(database, loadRun(database, "r_fixture"), { version: 1, projects: {} }, true, "none"), /still active/);
  assert.ok(existsSync(process.env.PARK_ALIVE)); process.kill(managed.server.pid, 0);
  process.env.PARK_BUSY = "0";
  await leaveCliSession(database, loadRun(database, "r_fixture"), { version: 1, projects: {} }, false, "none");
  process.kill(managed.server.pid, 0); assert.ok(existsSync(process.env.PARK_ALIVE), "dry run leaves tree untouched");
  await leaveCliSession(database, loadRun(database, "r_fixture"), { version: 1, projects: {} }, true, "none");
  const parked = loadRun(database, "r_fixture");
  assert.equal(parked.owner_state, "none"); assert.equal(parked.tmux_session_name, null);
  // A zombie no longer runs or listens; the TCP port must actually be closed.
  await assert.rejects(import("node:net").then(({createConnection}) => new Promise((resolve, reject) => {
    const socket = createConnection({host:"127.0.0.1",port:managed.server.port});
    socket.on("connect",()=>{socket.destroy();resolve(true);}); socket.on("error",reject);
  })));
  process.kill(unrelated.server.pid, 0);

  const remote = await tree("remote");
  database.exec("UPDATE runs SET state='parked_review',owner_state='cli'; UPDATE run_resources SET tmux_session_name='cx-fixture'");
  process.env.PARK_ROOT = String(remote.root.pid); writeFileSync(process.env.PARK_ALIVE, "1");
  await leaveCliSession(database, loadRun(database, "r_fixture"), { version: 1, projects: {} }, true, "remote");
  process.kill(remote.server.pid, 0); assert.equal(loadRun(database, "r_fixture").owner_state, "remote");

  const stubborn = await tree("stubborn", true);
  database.exec("UPDATE runs SET state='running',owner_state='cli'; UPDATE run_resources SET tmux_session_name='cx-fixture'");
  process.env.PARK_ROOT = String(stubborn.root.pid); writeFileSync(process.env.PARK_ALIVE, "1");
  await assert.rejects(leaveCliSession(database, loadRun(database, "r_fixture"), { version: 1, projects: {} }, true, "none"), /survived SIGTERM/);
  assert.equal(loadRun(database, "r_fixture").owner_state, "cli", "cleanup failure does not release ownership");
  assert.equal(existsSync(process.env.PARK_ALIVE), false, "tmux exited before bounded cleanup failure");
  assert.ok(existsSync(join(home, "logs/session-handoffs/r_fixture.txt.processes.json")), "provenance survives retry after pane loss");
  await assert.rejects(leaveCliSession(database, loadRun(database, "r_fixture"), { version: 1, projects: {} }, true, "none"), /survived SIGTERM/);
  assert.equal(loadRun(database, "r_fixture").owner_state, "cli", "dead-tmux retry failure still retains ownership");
  assert.equal(loadRun(database, "r_fixture").tmux_session_name, "cx-fixture", "retry retains the saved session fence");
  unlinkSync(join(home, "stubborn.json.block"));
  await leaveCliSession(database, loadRun(database, "r_fixture"), { version: 1, projects: {} }, true, "none");
  assert.equal(loadRun(database, "r_fixture").owner_state, "none", "retry uses saved exact ancestry");
  assert.equal(existsSync(join(home, "logs/session-handoffs/r_fixture.txt.processes.json")), false);

  const identity = { runId: "r_fixture", session: "cx-fixture", threadId: "thread" };
  const receipt = join(home, "receipt.json"); saveParkProcesses(receipt, identity, unrelated.processes);
  for (const changed of [{ ...identity, runId: "other" }, { ...identity, session: "other" }, { ...identity, threadId: "other" }])
    assert.throws(() => loadParkProcesses(receipt, changed), /provenance changed/);
  const savedReceipt = JSON.parse(readFileSync(receipt, "utf8"));
  writeFileSync(receipt, JSON.stringify({ ...savedReceipt, boot: "other-boot" }));
  assert.throws(() => loadParkProcesses(receipt, identity), /provenance changed/);
  saveParkProcesses(receipt, identity, unrelated.processes);
  const mismatch = unrelated.processes.map(entry => ({ ...entry, started: "0" }));
  assert.equal(await cleanupParkProcesses(mismatch), 0, "PID/start-time mismatch is not signalled");
  process.kill(unrelated.server.pid, 0);
  assert.equal(loadParkProcesses(receipt, identity).length, unrelated.processes.length);
  console.log(JSON.stringify({ok:true,parkProcesses:"real root/bash/listening-server orphan cleanup, unrelated same-cwd tree preserved, active/dry-run/Remote preserved, receipt provenance and PID reuse fenced"}));
} finally {
  database?.close();
  rmSync(join(home, "stubborn.json.block"), { force: true });
  for (const processes of captured) await cleanupParkProcesses(processes);
  for (const root of trees) root.kill("SIGTERM");
  rmSync(home, { recursive: true, force: true });
}
