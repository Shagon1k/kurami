import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";
const scenario = process.env.PROTOCOL_SCENARIO;
const threadId = "thread-exact";
const turnId = "turn-exact";
const send = (value) => process.stdout.write(JSON.stringify(value)+"\n");
const completed = (status="completed", id=turnId, thread=threadId) =>
  send({method:"turn/completed",params:{threadId:thread,turn:{id,status,
    error: status === "failed" ? {codexErrorInfo:scenario === "billing" ? "usageLimitExceeded" : "sandboxError"} : null}}});
const lines = createInterface({input:process.stdin});
for await (const line of lines) {
  const message = JSON.parse(line);
  appendFileSync(process.env.PROTOCOL_LOG,JSON.stringify(message)+"\n");
  if (message.id === "approval") {
    completed("interrupted");
    continue;
  }
  if (!message.method) continue;
  if ((scenario === "init_failure" && message.method === "initialize") ||
      (scenario === "thread_start_failure" && message.method === "thread/start")) {
    send({id:message.id,error:{code:-32603,message:"Fixture pre-binding failure"}});
    continue;
  }
  let result = {};
  if (message.method === "thread/start") {
    appendFileSync(process.env.PROTOCOL_LOG,JSON.stringify({environment:{
      writerToken:Boolean(process.env.GH_TOKEN), leakedApp:Boolean(process.env.GITHUB_APP_PRIVATE_KEY),
      leakedOther:Boolean(process.env.UNRELATED_SECRET)}})+"\n");
    result={thread:{id:threadId}};
  }
  if (message.method === "thread/read")
    result={thread:{id:threadId,turns:[{id:turnId,status:scenario === "history" ? "completed" : "inProgress"}]}};
  if (message.method === "turn/start") {
    if (scenario === "lost_ack") process.exit(1);
    result={turn:{id:turnId,status:"inProgress"}};
    if (scenario === "early") completed();
  }
  if (message.id !== undefined) send({id:message.id,result});
  if (message.method === "turn/start") {
    if (scenario === "disconnect") process.exit(1);
    if (scenario === "stale") { completed("completed","old-turn"); completed("completed",turnId,"other-thread"); }
    if (scenario === "approval" || scenario === "permission" || scenario === "unknown_request")
      send({id:"approval",method:scenario === "permission" ? "item/permissions/requestApproval" :
        scenario === "approval" ? "item/commandExecution/requestApproval" : "unknown/interactive",
        params:{threadId,turnId,itemId:"item-exact",permissions:{network:{enabled:true}}}});
    else if (scenario === "failure" || scenario === "billing") completed("failed");
    else if (scenario === "interrupted") completed("interrupted");
    else if (!["cancel","timeout","early"].includes(scenario)) {
      completed(); completed(); completed("failed");
    }
  }
  if (message.method === "turn/interrupt") completed("interrupted");
}
