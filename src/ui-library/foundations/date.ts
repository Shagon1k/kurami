/** Shared metadata formatting; date-only values keep their calendar day. */
export function formatSiteDate(value:string,lang:"ru"|"en",time=false):string {
  const dateOnly=/^\d{4}-\d{2}-\d{2}$/.test(value);
  const date=new Date(dateOnly?value+"T12:00:00Z":value);
  if(!Number.isFinite(date.getTime()))return "—";
  return new Intl.DateTimeFormat(lang==="ru"?"ru-RU":"en-GB",{
    timeZone:dateOnly?"UTC":"Europe/Vilnius",day:"2-digit",month:"short",
    ...(time?{hour:"2-digit",minute:"2-digit",hour12:false}:{year:"numeric"}),
  }).format(date);
}
