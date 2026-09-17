export type DailyObservation = {
  date:string; timezone:string; observedAt:string;
  stories:number|null;
  calendar:{events:number;allDay:number;busyMinutes:number;overlapMinutes:number}|null;
  inbox:{first:number;last:number;firstAt:string;lastAt:string}|null;
};
export type WeeklyReview = {
  version:1; state:"ready"|"partial"|"empty"; capturedAt:string;
  data:{
    publicationDate:string; start:string; end:string; timezone:string;
    days:DailyObservation[];
    coverage:{news:number;calendar:number;mail:number};
    totals:{stories:number|null;calendarMinutes:number|null;calendarEvents:number|null;archived:number;more:number;less:number};
    calendarDeltaMinutes:number|null;
    topics:Array<{id:string;label:string;more:number;less:number;net:number;previousNet:number}>;
    insights:string[];
  };
};

export function shiftDate(date:string,days:number):string {
  if(!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date))throw new Error("Invalid weekly date");
  const parsed=new Date(date+"T12:00:00Z");
  if(!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10)!==date)throw new Error("Invalid weekly date");
  parsed.setUTCDate(parsed.getUTCDate()+days);return parsed.toISOString().slice(0,10);
}
export function localDate(at:string,timezone:string):string {
  return new Intl.DateTimeFormat("en-CA",{timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(at));
}
export function isSunday(date:string):boolean {shiftDate(date,0);return new Date(date+"T12:00:00Z").getUTCDay()===0;}

export function parseWeeklyReview(value:unknown):WeeklyReview {
  const review=value as WeeklyReview, data=review?.data;
  if(review?.version!==1 || !["ready","partial","empty"].includes(review.state) || !Number.isFinite(Date.parse(review.capturedAt)) || !data)throw new Error("Invalid weekly review");
  if(shiftDate(data.publicationDate,-7)!==data.start || shiftDate(data.publicationDate,-1)!==data.end)throw new Error("Invalid weekly period");
  localDate(review.capturedAt,data.timezone);
  if(!Array.isArray(data.days)||data.days.length!==7||!Array.isArray(data.topics)||data.topics.length>8||!Array.isArray(data.insights)||data.insights.length>3)throw new Error("Invalid weekly collections");
  const number=(n:unknown,nullable=false)=>{if(n===null&&nullable)return;if(typeof n!=="number"||!Number.isSafeInteger(n)||Math.abs(n)>1e8)throw new Error("Invalid weekly number");};
  data.days.forEach((day,index)=>{
    if(day.date!==shiftDate(data.start,index)||day.timezone!==data.timezone)throw new Error("Invalid weekly day");
    number(day.stories,true);
    if(day.calendar)Object.values(day.calendar).forEach(n=>number(n));
    if(day.inbox){number(day.inbox.first);number(day.inbox.last);if(!Number.isFinite(Date.parse(day.inbox.firstAt))||!Number.isFinite(Date.parse(day.inbox.lastAt)))throw new Error("Invalid inbox timestamp");}
  });
  Object.values(data.coverage).forEach(n=>{number(n);if(n<0||n>7)throw new Error("Invalid coverage");});
  Object.values(data.totals).forEach(n=>number(n,true));number(data.calendarDeltaMinutes,true);
  data.topics.forEach(topic=>{if(typeof topic.id!=="string"||typeof topic.label!=="string"||topic.label.length>160)throw new Error("Invalid weekly topic");
    [topic.more,topic.less,topic.net,topic.previousNet].forEach(n=>number(n));});
  if(data.insights.some(text=>typeof text!=="string"||text.length>600))throw new Error("Invalid weekly insight");
  return review;
}
