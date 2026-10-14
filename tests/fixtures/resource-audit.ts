import type {ResourceAudit} from "../../src/system/maintenance/resource-audit.ts";
export const resourceAudit:ResourceAudit={version:1,id:"resource-"+"a".repeat(32),checkedAt:"2026-10-14T17:00:00Z",status:"ready",sessionId:"resource_audit_test",
  summary:{ru:"Нашла старый кеш. Сначала проверим, нужен ли он.",en:"Found an old cache. First check whether it is still needed."},
  analysis:{ru:"Основное место занимают сборки и временные файлы. Ничего не удалено.",en:"Builds and temporary files take most space. Nothing was deleted."},
  disk:{usedBytes:64*1024**3,availableBytes:128*1024**3,usedPercent:33.3,unaccountedBytes:10*1024**3},
  memory:{MemTotal:24*1024**3,MemAvailable:16*1024**3,usedBytes:8*1024**3,processGroups:[{name:"node",pssBytes:2*1024**3,processes:12}],unreadableProcesses:10},
  locations:[{path:"/tmp/cache",bytes:1024**3}],candidates:[{id:"old-cache",path:"/tmp/"+"long-cache-directory-".repeat(12),bytes:1024**3,kind:"temporary-cache",protected:false}],
  decisions:[{id:"old-cache",recommendation:"consider",ru:"Повторно проверить использование и запросить подтверждение.",en:"Recheck current use and request approval."}],limitations:[{ru:"Часть сведений о системных процессах недоступна.",en:"Some system-owned process metadata is inaccessible."}],databaseMounts:["/var/lib/docker/volumes/example-postgres/_data"]};
