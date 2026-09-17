export type WeeklyConfig={enabled:boolean;observationDays:7|28;error?:string};
import {readFile} from "node:fs/promises";
import {parse as parseYaml} from "yaml";
export async function readWeeklyConfig(path:string):Promise<WeeklyConfig> {
  const root=parseYaml(await readFile(path,"utf8"));
  return parseWeeklyConfig(root.weekly);
}
export function parseWeeklyConfig(value:unknown):WeeklyConfig {
  if(value===undefined)return {enabled:false,observationDays:7};
  if(!value||typeof value!=="object"||Array.isArray(value))return {enabled:false,observationDays:7,error:"invalid_weekly_config"};
  const raw=value as Record<string,unknown>;
  if(Object.keys(raw).some(key=>!["enabled","observationDays"].includes(key)) || typeof raw.enabled!=="boolean" || (raw.observationDays!==7&&raw.observationDays!==28))return {enabled:false,observationDays:7,error:"invalid_weekly_config"};
  return {enabled:raw.enabled,observationDays:raw.observationDays};
}
