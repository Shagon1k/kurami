// The docs Markdown subset: a small, strict parser with no dependencies and no raw HTML.
// Blocks: ## / ### / #### headings, paragraphs, - and 1. lists (nested by two spaces), GFM pipe tables,
// ``` fences (```diagram is a picture), :::name containers (more colons for an outer one) and ::name{…} leaves.
// Inline: `code`, **bold**, *italic*, [text](target). Everything else is escaped text.

export type Block=
  | {type:"heading";level:2|3|4;text:string}
  | {type:"paragraph";text:string}
  | {type:"list";ordered:boolean;items:Block[][]}
  | {type:"table";header:string[];rows:string[][]}
  | {type:"code";lang:string;title?:string;text:string}
  | {type:"container";name:string;args:string;body:Block[]}
  | {type:"leaf";name:string;attrs:Record<string,string>};

export type Frontmatter=Record<string,string|string[]>;

export function splitFrontmatter(source:string,context:string):{meta:Frontmatter;body:string} {
  const match=source.match(/^---\n([\s\S]*?)\n---\n?/);
  if(!match)throw new Error(`${context}: missing --- frontmatter`);
  const meta:Frontmatter={};
  for(const line of match[1]!.split("\n")){
    if(!line.trim())continue;
    const pair=line.match(/^([a-z][a-z0-9-]*):\s*(.*)$/);
    if(!pair)throw new Error(`${context}: bad frontmatter line: ${line}`);
    const value=pair[2]!.trim();
    meta[pair[1]!]=value.startsWith("[")&&value.endsWith("]")?value.slice(1,-1).split(",").map(item=>item.trim()).filter(Boolean):value.replace(/^"(.*)"$/,"$1");
  }
  return {meta,body:source.slice(match[0].length)};
}

const listItem=/^(\s*)([-*]|\d+\.)\s+(.*)$/;
const isTableSeparator=(line:string)=>/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line);
const cells=(line:string)=>{
  const trimmed=line.trim().replace(/^\|/,"").replace(/\|$/,"");
  const out:string[]=[];let current="",code=false;
  for(let i=0;i<trimmed.length;i++){
    const c=trimmed[i]!;
    if(c==="\\"&&trimmed[i+1]==="|"){current+="|";i++;continue;}
    if(c==="`")code=!code;
    if(c==="|"&&!code){out.push(current.trim());current="";continue;}
    current+=c;
  }
  out.push(current.trim());
  return out;
};
function startsBlock(line:string):boolean {
  return /^(#{1,6})\s/.test(line)||/^:{2,}/.test(line)||/^```/.test(line)||listItem.test(line)||/^\s*\|/.test(line);
}

export function parseBlocks(source:string,context:string):Block[] {
  const lines=source.replace(/\r/g,"").split("\n");
  const blocks:Block[]=[];
  let i=0;
  const fail=(message:string):never=>{throw new Error(`${context}:${i+1}: ${message}`);};
  while(i<lines.length){
    const line=lines[i]!;
    if(!line.trim()){i++;continue;}
    if(/^\s*</.test(line))fail("raw HTML is not allowed in docs Markdown");
    const container=line.match(/^(:{3,})\s*([a-z][a-z-]*)\s*(.*)$/);
    if(container){
      const fence=container[1]!;const start=i;i++;
      const inner:string[]=[];
      while(i<lines.length&&lines[i]!.trim()!==fence)inner.push(lines[i++]!);
      if(i>=lines.length){i=start;fail(`unclosed ${fence}${container[2]}`);}
      i++;
      blocks.push({type:"container",name:container[2]!,args:container[3]!.trim(),body:parseBlocks(inner.join("\n"),`${context} › ${container[2]}`)});
      continue;
    }
    const leaf=line.match(/^::([a-z][a-z-]*)\{(.*)\}\s*$/);
    if(leaf){
      const attrs:Record<string,string>={};
      const rest=leaf[2]!.replace(/([a-z][a-z-]*)="((?:[^"\\]|\\.)*)"/g,(_m,key:string,value:string)=>{attrs[key]=value.replace(/\\"/g,'"');return "";});
      if(rest.trim())fail(`bad attributes in ::${leaf[1]}{…}: ${rest.trim()}`);
      blocks.push({type:"leaf",name:leaf[1]!,attrs});i++;continue;
    }
    if(/^::/.test(line))fail("a leaf directive is ::name{key=\"value\"} on one line");
    const fence=line.match(/^```\s*([a-z0-9-]*)\s*(.*)$/);
    if(fence){
      const start=i;i++;const text:string[]=[];
      while(i<lines.length&&!/^```\s*$/.test(lines[i]!))text.push(lines[i++]!);
      if(i>=lines.length){i=start;fail("unclosed ``` fence");}
      i++;
      const title=fence[2]!.match(/^title="([^"]+)"$/)?.[1];
      if(fence[2]&&!title)fail('a fence takes only title="…" after the language');
      blocks.push({type:"code",lang:fence[1]!,title,text:text.join("\n")});
      continue;
    }
    const heading=line.match(/^(#{1,6})\s+(.+)$/);
    if(heading){
      const level=heading[1]!.length;
      if(level<2||level>4)fail("use ## to #### headings; the page title comes from frontmatter");
      blocks.push({type:"heading",level:level as 2|3|4,text:heading[2]!.trim()});i++;continue;
    }
    if(/^\s*\|/.test(line)){
      if(!isTableSeparator(lines[i+1]??""))fail("a table needs a header row and a --- separator row");
      const header=cells(line);i+=2;
      const rows:string[][]=[];
      while(i<lines.length&&/^\s*\|/.test(lines[i]!)){
        const row=cells(lines[i]!);
        if(row.length!==header.length)fail(`table row has ${row.length} cells, header has ${header.length}`);
        rows.push(row);i++;
      }
      if(!rows.length)fail("a table needs at least one row");
      blocks.push({type:"table",header,rows});continue;
    }
    const item=line.match(listItem);
    if(item){
      const indent=item[1]!.length,ordered=/\d/.test(item[2]!);
      const items:string[][]=[];
      while(i<lines.length){
        const current=lines[i]!;
        const match=current.match(listItem);
        if(match&&match[1]!.length===indent){
          if(/\d/.test(match[2]!)!==ordered)break;
          items.push([match[3]!]);i++;continue;
        }
        if(!current.trim()){
          const next=lines[i+1]??"";
          const nextItem=next.match(listItem);
          if(nextItem&&nextItem[1]!.length===indent||next.startsWith(" ".repeat(indent+2))&&next.trim()){items.at(-1)!.push("");i++;continue;}
          break;
        }
        if(current.startsWith(" ".repeat(indent+2))||!startsBlock(current)&&!current.match(listItem)){items.at(-1)!.push(current.startsWith(" ".repeat(indent+2))?current.slice(indent+2):current.trim());i++;continue;}
        break;
      }
      blocks.push({type:"list",ordered,items:items.map(content=>parseBlocks(content.join("\n"),context))});
      continue;
    }
    const paragraph:string[]=[];
    while(i<lines.length&&lines[i]!.trim()&&!(paragraph.length&&startsBlock(lines[i]!))){
      if(/^\s*</.test(lines[i]!))fail("raw HTML is not allowed in docs Markdown");
      paragraph.push(lines[i++]!.trim());
    }
    blocks.push({type:"paragraph",text:paragraph.join(" ")});
  }
  return blocks;
}

export const escapeText=(value:string)=>value.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");

/** Renders inline Markdown. `link` maps a target to an href (and may throw for an unknown page). */
export function renderInline(text:string,link:(target:string)=>{href:string;external?:boolean}):string {
  const codes:string[]=[];
  let out=text.replace(/`([^`]+)`/g,(_m,code:string)=>{codes.push(`<code>${escapeText(code)}</code>`);return `\u0000${codes.length-1}\u0000`;});
  out=escapeText(out);
  out=out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g,(_m,label:string,target:string)=>{
    const resolved=link(target.replaceAll("&amp;","&"));
    return `<a href="${escapeText(resolved.href)}"${resolved.external?' rel="noopener noreferrer"':""}>${label}</a>`;
  });
  out=out.replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g,"<strong>$1</strong>");
  out=out.replace(/(?<![*\w])\*(?=\S)(.+?)(?<=\S)\*(?![*\w])/g,"<em>$1</em>");
  if(/[*]{2}|\[[^\]]*\]\(/.test(out.replace(/<[^>]+>/g,"")))throw new Error(`Unbalanced inline Markdown in: ${text.slice(0,80)}`);
  return out.replace(/\u0000(\d+)\u0000/g,(_m,index:string)=>codes[Number(index)]!);
}

/** Plain text of inline Markdown, for ids, titles and word counts. */
export function plainInline(text:string):string {
  return text.replace(/`([^`]+)`/g,"$1").replace(/\[([^\]]+)\]\([^)]+\)/g,"$1").replace(/\*\*|\*/g,"");
}

export function headingId(text:string):string {
  return plainInline(text).toLowerCase().replace(/[^\p{L}\p{N}]+/gu,"-").replace(/^-+|-+$/g,"").slice(0,60)||"section";
}

export function wordCount(blocks:Block[]):number {
  let count=0;
  const words=(text:string)=>plainInline(text).split(/\s+/).filter(Boolean).length;
  const walk=(list:Block[])=>{for(const block of list){
    if(block.type==="paragraph"||block.type==="heading")count+=words(block.text);
    else if(block.type==="list")block.items.forEach(walk);
    else if(block.type==="table")count+=[...block.header,...block.rows.flat()].reduce((sum,cell)=>sum+words(cell),0);
    else if(block.type==="container")walk(block.body);
    else if(block.type==="code"&&block.lang!=="diagram")count+=Math.round(block.text.split(/\s+/).length/3);
  }};
  walk(blocks);
  return count;
}
