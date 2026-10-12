import { readFileSync, readdirSync, writeFileSync, unlinkSync } from "node:fs";
import { runFile } from "./session-shared.ts";

export type ParkProcess = { pid: number; parent: number; started: string; state: string };
type ParkIdentity = { runId: string; session: string; threadId: string };

export function saveParkProcesses(path: string, identity: ParkIdentity, processes: ParkProcess[]): void {
  writeFileSync(path, JSON.stringify({ ...identity, boot: readFileSync("/proc/sys/kernel/random/boot_id", "utf8"), processes }), { mode: 0o600 });
}

export function loadParkProcesses(path: string, identity: ParkIdentity): ParkProcess[] {
  let receipt;
  try { receipt = JSON.parse(readFileSync(path, "utf8")); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new Error("Park refused: saved descendant evidence unavailable");
  }
  if (receipt.runId !== identity.runId || receipt.session !== identity.session || receipt.threadId !== identity.threadId ||
      receipt.boot !== readFileSync("/proc/sys/kernel/random/boot_id", "utf8") || !Array.isArray(receipt.processes) ||
      receipt.processes.some((entry: ParkProcess) => !Number.isSafeInteger(entry.pid) || entry.pid <= 1 || entry.pid === process.pid || !/^\d+$/u.test(entry.started)))
    throw new Error("Park refused: saved descendant provenance changed");
  return receipt.processes;
}

export function clearParkProcesses(path: string): void {
  try { unlinkSync(path); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function processIdentity(pid: number): ParkProcess | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    return { pid, parent: Number(fields[1]), started: fields[19]!, state: fields[0]! };
  } catch (error) {
    if (["ENOENT", "ESRCH"].includes((error as NodeJS.ErrnoException).code ?? "")) return null;
    throw new Error("Park refused: descendant process evidence unavailable");
  }
}

/** Snapshot ancestry while the exact managed pane still exists, never by cwd/name. */
export function captureParkProcesses(session: string): ParkProcess[] {
  const roots = runFile("tmux", ["list-panes", "-s", "-t", `=${session}`, "-F", "#{pane_pid}"])
    .split("\n").map(Number);
  if (!roots.length || roots.some(pid => !Number.isSafeInteger(pid) || pid <= 1 || pid === process.pid))
    throw new Error("Park refused: managed pane process identity unavailable");
  const processes = descendantProcesses(roots);
  if (processes.some(entry => entry.pid === process.pid))
    throw new Error("Park refused: cleanup process is inside the managed pane");
  return processes;
}

export function descendantProcesses(roots: number[]): ParkProcess[] {
  const processes = readdirSync("/proc").filter(value => /^\d+$/u.test(value))
    .map(value => processIdentity(Number(value))).filter((value): value is ParkProcess => value !== null);
  const owned = new Set(roots);
  let changed = true;
  while (changed) {
    changed = false;
    for (const entry of processes) if (owned.has(entry.parent) && !owned.has(entry.pid)) {
      owned.add(entry.pid); changed = true;
    }
  }
  return processes.filter(entry => owned.has(entry.pid)).reverse();
}

function surviving(processes: ParkProcess[]): ParkProcess[] {
  return processes.filter(entry => {
    const current = processIdentity(entry.pid);
    return current?.started === entry.started && !["Z", "X"].includes(current.state);
  });
}

/** Only after completion validation and tmux exit; PID reuse is never signalled. */
export async function cleanupParkProcesses(processes: ParkProcess[]): Promise<number> {
  const remaining = surviving(processes);
  if (remaining.length) {
    try {
      runFile("python3", [`${import.meta.dirname}/park-processes.py`, JSON.stringify(remaining)]);
    } catch (error) {
      // Missing Python/pidfd support or permission errors must retain ownership;
      // a numeric-PID fallback would reintroduce the identity race.
      throw new Error("Park refused: identity-bound descendant termination failed (Python 3.9+ and Linux pidfd required)", { cause: error });
    }
  }
  for (let attempt = 0; attempt < 40; attempt++) {
    if (!surviving(processes).length) return remaining.length;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error("Park refused: managed descendants survived SIGTERM; ownership retained");
}
