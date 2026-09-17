import {createHash} from "node:crypto";
import {briefingPaths,initializeBriefingStore,openBriefingDatabase,readEditionHtml,validateRenderedHtml,type EditionRow} from "../store.ts";
import {parseBriefingPayload} from "../model.ts";
import {DAILY_RETENTION_DAYS} from "../runtime-config.ts";

/** Explicit metadata migration; stored HTML, sources, reactions and media stay unchanged. */
export async function extendDailyRetention(paths=briefingPaths()):Promise<number> {
  await initializeBriefingStore(paths);
  const database=openBriefingDatabase(paths);
  let updated=0;
  try {
    const rows=database.prepare("SELECT * FROM editions WHERE edition_type='daily' AND state IN ('complete','partial')").all() as EditionRow[];
    for(const row of rows) {
      const retentionUntil=new Date(Date.parse(row.local_date+"T00:00:00Z")+DAILY_RETENTION_DAYS*86_400_000).toISOString();
      if(row.retention_until===retentionUntil)continue;
      const payload=parseBriefingPayload(JSON.parse(row.payload_json)),html=await readEditionHtml(row,paths);
      payload.edition.retentionUntil=retentionUntil;
      validateRenderedHtml(html,payload);
      const encoded=JSON.stringify(payload);
      const digest=createHash("sha256").update(encoded).update("\0").update(html).digest("hex");
      const result=database.prepare("UPDATE editions SET payload_json=?,retention_until=?,content_digest=? WHERE id=? AND content_digest=?")
        .run(encoded,retentionUntil,digest,row.id,row.content_digest);
      if(result.changes!==1)throw new Error("Retention migration lost optimistic lock");
      updated++;
    }
  } finally {database.close();}
  return updated;
}
if(import.meta.main) {
  if(process.argv.slice(2).join(" ")!=="--apply")throw new Error("Explicit --apply required");
  console.log(JSON.stringify({ok:true,updated:await extendDailyRetention(),days:DAILY_RETENTION_DAYS}));
}
