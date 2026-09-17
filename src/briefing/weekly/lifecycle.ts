import type {DatabaseSync} from "node:sqlite";
import {parseBriefingPayload,type BriefingPayload,type BriefingAddonEnvelope} from "../model.ts";
import {loadAddonSnapshot,upsertAddonSnapshot} from "../store.ts";
import {buildWeeklyReview} from "./build.ts";
import {parseWeeklyReview,isSunday,localDate,type WeeklyReview} from "./model.ts";
import {observeDaily,pruneWeeklyObservations} from "./observations.ts";
import type {WeeklyConfig} from "./config.ts";

export function collectWeeklyHistory(database:DatabaseSync,config:WeeklyConfig,at:string,timezone:string):void {
  if(!config.enabled){pruneWeeklyObservations(database,at,timezone,config.observationDays);return;}
  for(const row of database.prepare("SELECT payload_json FROM editions WHERE edition_type='daily' AND state IN ('complete','partial') ORDER BY local_date").all() as Array<{payload_json:string}>) {
    const payload=parseBriefingPayload(JSON.parse(row.payload_json));
    payload.addons.weekly??={version:1,state:"empty",capturedAt:at,data:{policy:config}};
    observeDaily(database,payload,at);
  }
  // Historical action receipts prove only actions taken through this app.
  for(const row of database.prepare("SELECT a.action_id,a.updated_at,a.item_ids_json,e.timezone FROM action_receipts a JOIN editions e ON e.id=a.edition_id WHERE a.action_type='mail.read_and_archive' AND a.state='complete'").all() as Array<{action_id:string;updated_at:string;item_ids_json:string;timezone:string}>) {
    database.prepare("INSERT OR IGNORE INTO weekly_mail_actions(action_id,local_date,item_count) VALUES(?,?,?)")
      .run(row.action_id,localDate(row.updated_at,row.timezone),JSON.parse(row.item_ids_json).length);
  }
  pruneWeeklyObservations(database,at,timezone,config.observationDays);
}

export function attachWeeklyReview(database:DatabaseSync,payload:BriefingPayload,config:WeeklyConfig,at:string):void {
  if(!config.enabled||!isSunday(payload.edition.localDate))return;
  collectWeeklyHistory(database,config,at,payload.edition.timezone);
  const review=parseWeeklyReview(buildWeeklyReview(database,payload.edition.localDate,payload.edition.timezone,at));
  if(review.state==="empty")return;
  payload.addons.weekly={version:1,state:review.state,capturedAt:at,data:{policy:config,review}};
}

export function promoteWeeklyReview(database:DatabaseSync,payload:BriefingPayload):void {
  const raw=payload.addons.weekly?.data.review;
  if(!raw)return;
  const review=parseWeeklyReview(raw);
  if(review.data.publicationDate!==payload.edition.localDate || !isSunday(review.data.publicationDate) || review.state==="empty")throw new Error("Invalid weekly publication");
  const previous=loadWeeklyReview(database);
  if(previous && previous.data.publicationDate>review.data.publicationDate)return;
  upsertAddonSnapshot(database,"weekly",review as unknown as BriefingAddonEnvelope);
}
export function loadWeeklyReview(database:DatabaseSync):WeeklyReview|null {
  const value=loadAddonSnapshot(database,"weekly");
  return value?parseWeeklyReview(value.envelope):null;
}
