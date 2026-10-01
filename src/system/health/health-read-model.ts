import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readHealthCycle } from "./health-cycle.ts";
import { healthSurfaceSnapshot, validHealthSurfaceSnapshot, type HealthSurfaceSnapshot } from "./health-snapshot.ts";
import type { HealthAlertState } from "./server-health.ts";

export function readHealthStatus(home: string): {health: HealthSurfaceSnapshot | null; active: HealthAlertState["active"]} {
  try {
    const cycle = readHealthCycle(home);
    if (cycle) return {health: healthSurfaceSnapshot(cycle.result), active: cycle.alerts.active};
    let active: HealthAlertState["active"] = {};
    try {active = JSON.parse(readFileSync(resolve(home, "state/runtime-health-alert.json"), "utf8")).active ?? {};} catch {}
    try {
      const snapshot = JSON.parse(readFileSync(resolve(home, "state/system-health-snapshot.json"), "utf8"));
      return {health: validHealthSurfaceSnapshot(snapshot) ? snapshot : null, active};
    } catch {return {health: null, active};}
  } catch {return {health: null, active: {}};}
}
