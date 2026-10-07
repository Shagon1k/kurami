import {mkdir, rename, writeFile} from "node:fs/promises";
import {dirname} from "node:path";
import type {RuntimeHealthResult} from "../../orchestrator/health/runtime.ts";
import type {DiskForecast} from "./disk-trend.ts";

/** Public metrics shared by the Discord health card and Hub; no process arguments or paths. */
export function healthSurfaceSnapshot(result:RuntimeHealthResult,diskForecast:DiskForecast|null=null) {
  return {version:1 as const,checkedAt:result.checkedAt,ok:result.ok,
    server:result.server,cpuStatistics:result.cpuStatistics,
    network:{status:result.networkConnectivity.status,latencyMs:result.networkConnectivity.latencyMs},
    speed:result.networkSpeed?{downloadMbps:result.networkSpeed.downloadMbps,uploadMbps:result.networkSpeed.uploadMbps,checkedAt:result.networkSpeed.checkedAt}:null,
    disk:result.resourceGuard.disk,diskForecast,
    orchestrator:{database:result.databaseIntegrity,containers:result.containerRuntime,
      previews:result.activePreviewLeases,worktrees:result.resourceGuard.worktrees.global,
      worktreeLimit:result.resourceGuard.worktrees.maxGlobal,quarantined:result.resourceGuard.quarantines.quarantined,
      backupAgeHours:result.backupAgeHours,backupMaxAgeHours:result.backupMaxAgeHours,backupFresh:result.backupFresh},
    issues:result.alertIssues.map(issue=>({key:issue.key,severity:issue.severity,message:issue.message}))};
}
export type HealthSurfaceSnapshot=ReturnType<typeof healthSurfaceSnapshot>;

export function validHealthSurfaceSnapshot(value:any):value is HealthSurfaceSnapshot {
  try {
    const finite=(values:unknown[])=>values.every(number=>typeof number==="number"&&Number.isFinite(number));
    const optional=(number:unknown)=>number===null||typeof number==="number"&&Number.isFinite(number);
    return value.version===1&&typeof value.ok==="boolean"&&Number.isFinite(Date.parse(value.checkedAt))&&
      finite([value.server.cpuUsedPercent,value.server.cpuCores,value.server.memoryUsedPercent,value.server.memoryUsedGiB,value.server.memoryTotalGiB,value.server.memoryAvailableGiB,value.server.uptimeSeconds,value.disk.usedPercent,value.disk.availableGiB])&&
      optional(value.cpuStatistics.averagePercent)&&optional(value.cpuStatistics.peakPercent)&&
      ["online","degraded","offline"].includes(value.network.status)&&optional(value.network.latencyMs)&&
      (!value.speed||finite([value.speed.downloadMbps,value.speed.uploadMbps]))&&
      typeof value.orchestrator.database==="string"&&finite([value.orchestrator.containers.running,value.orchestrator.containers.unhealthy,value.orchestrator.previews,value.orchestrator.worktrees,value.orchestrator.worktreeLimit,value.orchestrator.quarantined,value.orchestrator.backupMaxAgeHours])&&optional(value.orchestrator.backupAgeHours)&&
      Array.isArray(value.issues);
  }catch{return false;}
}

export async function writeHealthSurfaceSnapshot(path:string,result:RuntimeHealthResult,diskForecast:DiskForecast|null=null):Promise<void> {
  await mkdir(dirname(path),{recursive:true});
  const temporary=`${path}.${process.pid}.tmp`;
  await writeFile(temporary,JSON.stringify(healthSurfaceSnapshot(result,diskForecast))+"\n",{mode:0o600});
  await rename(temporary,path);
}
