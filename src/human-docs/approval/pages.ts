// Print a stable digest of every docs page in a checkout: {slug: {titleRu, hash}}.
// Usage: node src/human-docs/approval/pages.ts <checkout-root>
// The worker runs it once for the proposal base and once for the draft to list changed pages on the card.
import {createHash} from "node:crypto";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";

if(import.meta.main){
  const root=process.argv[2];
  if(!root)throw new Error("Usage: pages.ts <checkout-root>");
  const {pages}=await import(pathToFileURL(resolve(root,"src/human-docs/content.ts")).href) as {pages:Array<{slug:string;title:{ru:string}}>};
  const digest:Record<string,{titleRu:string;hash:string}>={};
  for(const page of pages)digest[page.slug]={titleRu:page.title.ru,hash:createHash("sha256").update(JSON.stringify(page)).digest("hex")};
  process.stdout.write(`${JSON.stringify(digest)}\n`);
}
