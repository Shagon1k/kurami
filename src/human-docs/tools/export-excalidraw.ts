// Exports the diagrams of docs pages as Excalidraw scenes for viewing or sketching in excalidraw.com.
// The Markdown ```diagram block stays the source of truth: edits made in Excalidraw do not flow back.
// Usage: node src/human-docs/tools/export-excalidraw.ts [slug ...]   → dist/human-docs-excalidraw/<slug>-<n>-<lang>.excalidraw
import {mkdirSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {allPages} from "../content.ts";
import {walk} from "../content/schema.ts";
import {renderDiagram} from "../diagrams/kit.ts";

const wanted=process.argv.slice(2);
const out=resolve(import.meta.dirname,"../../../dist/human-docs-excalidraw");
mkdirSync(out,{recursive:true});
let count=0;
for(const page of allPages.filter(page=>!wanted.length||wanted.includes(page.slug)))for(const lang of ["ru","en"] as const){
  let index=0;
  walk(page.blocks[lang],block=>{
    if(block.type!=="code"||block.lang!=="diagram")return;
    index++;
    writeFileSync(resolve(out,`${page.slug}-${index}-${lang}.excalidraw`),renderDiagram(block.text).excalidraw);
    count++;
  });
}
console.log(`Exported ${count} Excalidraw scenes into ${out}`);
