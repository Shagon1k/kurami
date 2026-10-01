// Diagram kit: a small text DSL → deterministic layout → themed SVG (inlined by the docs site) and an
// Excalidraw scene for hand inspection. No dependencies: the docs release builds in a bare worktree.
// Three engines cover every docs picture: `graph` (flows, architecture, boundaries, layers, state
// machines, entities, decision trees), `sequence` (who talks to whom, in order) and `timeline` (a day).
// Colours are the light diagram palette only; inlineDiagram() maps them to theme roles.

export type DiagramKind="graph"|"sequence"|"timeline";
export type DiagramSpec={kind:DiagramKind;title?:string;desc:string;direction:"right"|"down";lines:string[][]};

const C={surface:"#ffffff",panel:"#faf8f2",ink:"#0b0b0b",muted:"#5e5e59",accent:"#e21b16",soft:"#fff0ed",success:"#147844",warning:"#9b5b00"} as const;
const FONT="Onest, system-ui, sans-serif", MONO="Fragment Mono, ui-monospace, monospace", NOTE="Caveat, cursive";

// ---------------------------------------------------------------- parsing

function tokenize(line:string):string[] {
  const tokens:string[]=[];
  for(const match of line.matchAll(/"((?:[^"\\]|\\.)*)"|(\S+)/g))tokens.push(match[1]!==undefined?`"${match[1].replace(/\\"/g,'"')}`:match[2]!);
  return tokens;
}
const isQuoted=(token:string|undefined)=>token!==undefined&&token.startsWith('"');
const unquote=(token:string)=>token.slice(1);

export function parseDiagram(source:string):DiagramSpec {
  let kind:DiagramKind|undefined, title:string|undefined, desc:string|undefined, direction:"right"|"down"="right";
  const lines:string[][]=[];
  for(const raw of source.split("\n")){
    const line=raw.replace(/\s+#\s.*$/,"").trim();
    if(!line||line.startsWith("#"))continue;
    const header=line.match(/^(kind|title|desc|direction):\s*(.+)$/);
    if(header){
      const value=header[2]!.trim();
      if(header[1]==="kind"){if(!["graph","sequence","timeline"].includes(value))throw new Error(`Unknown diagram kind ${value}`);kind=value as DiagramKind;}
      else if(header[1]==="title")title=value;
      else if(header[1]==="desc")desc=value;
      else {if(value!=="right"&&value!=="down")throw new Error(`Diagram direction must be right or down`);direction=value;}
      continue;
    }
    lines.push(tokenize(line));
  }
  if(!kind)throw new Error("Diagram needs `kind: graph|sequence|timeline`");
  if(!desc||desc.length<20)throw new Error("Diagram needs `desc:` — a one to three sentence text equivalent");
  return {kind,title,desc,direction,lines};
}

// ---------------------------------------------------------------- text metrics

function charWidth(c:string):number {
  if(c===" ")return .27;
  if(/[iljtfr.,:;'|!()\[\]]/.test(c))return .3;
  if(/[mwMW]/.test(c))return .82;
  if(/[A-Z]/.test(c))return .66;
  if(/[0-9]/.test(c))return .58;
  if(/[шщжюыфмШЩЖЮЫФМ]/.test(c))return .78;
  if(/[А-ЯЁ]/.test(c))return .68;
  if(/[а-яё]/.test(c))return .57;
  if(/[·→←↔—–]/.test(c))return .7;
  return .55;
}
export function textWidth(text:string,size:number,{weight=400,font="sans"}:{weight?:number;font?:"sans"|"mono"|"note"}={}):number {
  if(font==="mono")return text.length*size*.6;
  const base=[...text].reduce((sum,c)=>sum+charWidth(c),0)*size;
  return font==="note"?base*.8:base*(weight>=600?1.1:1.05);
}
export function wrap(text:string,size:number,max:number,options:{weight?:number;font?:"sans"|"mono"|"note"}={}):string[] {
  const lines:string[]=[];
  for(const paragraph of text.split("\\n")){
    let current="";
    for(const word of paragraph.split(/\s+/).filter(Boolean)){
      const next=current?`${current} ${word}`:word;
      if(current&&textWidth(next,size,options)>max){lines.push(current);current=word;}
      else current=next;
    }
    lines.push(current);
  }
  return lines;
}

// ---------------------------------------------------------------- scene primitives

type Rect={type:"rect";x:number;y:number;w:number;h:number;r:number;fill:string;stroke:string;sw:number;dash?:boolean;id?:string};
type Ellipse={type:"ellipse";cx:number;cy:number;rx:number;ry:number;fill:string;stroke:string;sw:number};
type Poly={type:"poly";points:[number,number][];stroke:string;sw:number;dash?:boolean;arrowEnd?:boolean;arrowStart?:boolean;fill?:string;closed?:boolean;round?:number;id?:string};
type Text={type:"text";x:number;y:number;lines:string[];size:number;weight:number;fill:string;anchor:"start"|"middle"|"end";font:"sans"|"mono"|"note";lineHeight?:number};
type Shape=Rect|Ellipse|Poly|Text;
type Scene={width:number;height:number;shapes:Shape[]};

const xml=(value:string)=>value.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
const n=(value:number)=>Math.round(value*10)/10;

function roundedPath(points:[number,number][],radius:number):string {
  if(points.length<3||!radius)return `M${points.map(([x,y])=>`${n(x)} ${n(y)}`).join(" L")}`;
  let d=`M${n(points[0]![0])} ${n(points[0]![1])}`;
  for(let i=1;i<points.length-1;i++){
    const [px,py]=points[i-1]!,[x,y]=points[i]!,[nx,ny]=points[i+1]!;
    const inLen=Math.hypot(x-px,y-py),outLen=Math.hypot(nx-x,ny-y);
    const r=Math.min(radius,inLen/2,outLen/2);
    const ax=x-(x-px)/inLen*r,ay=y-(y-py)/inLen*r,bx=x+(nx-x)/outLen*r,by=y+(ny-y)/outLen*r;
    d+=` L${n(ax)} ${n(ay)} Q${n(x)} ${n(y)} ${n(bx)} ${n(by)}`;
  }
  const last=points.at(-1)!;
  return `${d} L${n(last[0])} ${n(last[1])}`;
}

function toSvg(scene:Scene,title:string,desc:string):string {
  const fontOf=(font:Text["font"])=>font==="mono"?MONO:font==="note"?NOTE:FONT;
  const body=scene.shapes.map(shape=>{
    if(shape.type==="rect")return `<rect x="${n(shape.x)}" y="${n(shape.y)}" width="${n(shape.w)}" height="${n(shape.h)}" rx="${shape.r}" fill="${shape.fill}" stroke="${shape.stroke}" stroke-width="${shape.sw}"${shape.dash?' stroke-dasharray="6 5"':""}/>`;
    if(shape.type==="ellipse")return `<ellipse cx="${n(shape.cx)}" cy="${n(shape.cy)}" rx="${n(shape.rx)}" ry="${n(shape.ry)}" fill="${shape.fill}" stroke="${shape.stroke}" stroke-width="${shape.sw}"/>`;
    if(shape.type==="poly"){
      const d=shape.closed?`M${shape.points.map(([x,y])=>`${n(x)} ${n(y)}`).join(" L")} Z`:roundedPath(shape.points,shape.round??0);
      const marker=shape.stroke===C.accent?"tip-accent":shape.stroke===C.muted?"tip-muted":"tip";
      return `<path d="${d}" fill="${shape.fill??"none"}" stroke="${shape.stroke}" stroke-width="${shape.sw}" stroke-linejoin="round" stroke-linecap="round"${shape.dash?' stroke-dasharray="6 5"':""}${shape.arrowEnd?` marker-end="url(#${marker})"`:""}${shape.arrowStart?` marker-start="url(#${marker})"`:""}/>`;
    }
    const lineHeight=shape.lineHeight??shape.size*1.3;
    const top=shape.y-(shape.lines.length-1)*lineHeight/2;
    return `<text x="${n(shape.x)}" y="${n(top)}" font-family="${fontOf(shape.font)}" font-size="${shape.size}" font-weight="${shape.weight}" fill="${shape.fill}" text-anchor="${shape.anchor}" dominant-baseline="central">${shape.lines.map((line,index)=>index===0?`<tspan x="${n(shape.x)}">${xml(line)}</tspan>`:`<tspan x="${n(shape.x)}" dy="${n(lineHeight)}">${xml(line)}</tspan>`).join("")}</text>`;
  }).join("");
  const marker=(id:string,color:string)=>`<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 1 L9 5 L0 9" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></marker>`;
  const defs=`<defs>${marker("tip",C.ink)}${marker("tip-accent",C.accent)}${marker("tip-muted",C.muted)}</defs>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(scene.width)}" height="${Math.ceil(scene.height)}" viewBox="0 0 ${Math.ceil(scene.width)} ${Math.ceil(scene.height)}" role="img" aria-labelledby="title desc"><title id="title">${xml(title)}</title><desc id="desc">${xml(desc)}</desc>${defs}<rect width="${Math.ceil(scene.width)}" height="${Math.ceil(scene.height)}" fill="${C.surface}"/>${body}</svg>`;
}

function toExcalidraw(scene:Scene):string {
  let seq=0;
  const seed=()=>(seq+=1)*7919%2147483647;
  const base=(type:string,x:number,y:number,w:number,h:number,extra:Record<string,unknown>)=>({id:`k${seq+1}`,type,x,y,width:w,height:h,angle:0,strokeColor:C.ink,backgroundColor:"transparent",fillStyle:"solid",strokeWidth:1,strokeStyle:"solid",roughness:0,opacity:100,groupIds:[],frameId:null,roundness:null,seed:seed(),version:1,versionNonce:seq*31,isDeleted:false,boundElements:null,updated:0,link:null,locked:false,...extra});
  const elements=scene.shapes.map(shape=>{
    if(shape.type==="rect")return base("rectangle",shape.x,shape.y,shape.w,shape.h,{strokeColor:shape.stroke,backgroundColor:shape.fill,strokeWidth:shape.sw,strokeStyle:shape.dash?"dashed":"solid",roundness:shape.r?{type:3}:null});
    if(shape.type==="ellipse")return base("ellipse",shape.cx-shape.rx,shape.cy-shape.ry,shape.rx*2,shape.ry*2,{strokeColor:shape.stroke,backgroundColor:shape.fill,strokeWidth:shape.sw});
    if(shape.type==="poly"){
      const [ox,oy]=shape.points[0]!;
      const points=[...shape.points,...(shape.closed?[shape.points[0]!]:[])].map(([x,y])=>[x-ox,y-oy]);
      const xs=points.map(p=>p[0]!),ys=points.map(p=>p[1]!);
      return base(shape.arrowEnd||shape.arrowStart?"arrow":"line",ox,oy,Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys),{points,strokeColor:shape.stroke,backgroundColor:shape.fill??"transparent",strokeWidth:shape.sw,strokeStyle:shape.dash?"dashed":"solid",startArrowhead:shape.arrowStart?"arrow":null,endArrowhead:shape.arrowEnd?"arrow":null,startBinding:null,endBinding:null,elbowed:false});
    }
    const text=shape.lines.join("\n"),lineHeight=1.25;
    const width=Math.max(...shape.lines.map(line=>textWidth(line,shape.size,{weight:shape.weight,font:shape.font})));
    const height=shape.lines.length*shape.size*lineHeight;
    const x=shape.anchor==="middle"?shape.x-width/2:shape.anchor==="end"?shape.x-width:shape.x;
    return base("text",x,shape.y-height/2,width,height,{strokeColor:shape.fill,text,originalText:text,fontSize:shape.size,fontFamily:shape.font==="mono"?3:shape.font==="note"?1:2,textAlign:shape.anchor==="middle"?"center":shape.anchor==="end"?"right":"left",verticalAlign:"middle",lineHeight,baseline:shape.size,containerId:null,autoResize:true});
  });
  return JSON.stringify({type:"excalidraw",version:2,source:"kurami-docs diagram kit",elements,appState:{viewBackgroundColor:C.surface,gridSize:null},files:{}},null,1);
}

// ---------------------------------------------------------------- graph engine

type NodeKind="process"|"store"|"actor"|"owner"|"external"|"state"|"start"|"end"|"fail"|"wait"|"decision"|"entity"|"note";
const nodeKinds:NodeKind[]=["process","store","actor","owner","external","state","start","end","fail","wait","decision","entity","note"];
type GNode={id:string;label:string;sub?:string;kind:NodeKind;col:number;row:number;w:number;h:number;x:number;y:number;labelLines:string[];subLines:string[];placed:boolean};
type GroupKind="boundary"|"band"|"highlight";
type GGroup={id:string;label:string;members:string[];kind:GroupKind};
type EdgeStyle="solid"|"dashed"|"accent"|"muted";
type GEdge={from:string;to:string;label?:string;style:EdgeStyle;both:boolean;none:boolean};

const LABEL=14.5, SUB=12.5, PAD_X=14, PAD_Y=11, MAX_W=210, MIN_W=112;

function sizeNode(node:GNode){
  if(node.kind==="note"){
    node.labelLines=wrap(node.label,17,200,{font:"note"});
    node.w=Math.max(...node.labelLines.map(line=>textWidth(line,17,{font:"note"})))+8;
    node.h=node.labelLines.length*20+6;
    return;
  }
  if(node.kind==="entity"){
    const fields=(node.sub??"").split("·").map(value=>value.trim()).filter(Boolean);
    node.labelLines=[node.label];node.subLines=fields;
    node.w=Math.max(MIN_W+20,textWidth(node.label,LABEL,{weight:700,font:"mono"})+PAD_X*2,...fields.map(field=>textWidth(field,12,{font:"mono"})+PAD_X*2));
    node.h=34+fields.length*19+10;
    return;
  }
  const pill=["state","start","end","fail","wait"].includes(node.kind);
  const maxText=MAX_W-PAD_X*2;
  node.labelLines=wrap(node.label,LABEL,maxText,{weight:600});
  node.subLines=node.sub?wrap(node.sub,SUB,maxText):[];
  const textW=Math.max(...node.labelLines.map(line=>textWidth(line,LABEL,{weight:600})),...node.subLines.map(line=>textWidth(line,SUB)));
  node.w=Math.max(pill?96:MIN_W,Math.ceil(textW+PAD_X*2+(pill?12:0)+(node.kind==="decision"?28:0)));
  node.h=Math.ceil(node.labelLines.length*18+(node.subLines.length?node.subLines.length*16+6:0)+PAD_Y*2+(node.kind==="store"?12:0));
  if(pill)node.h=Math.max(node.h,40);
}

function parseGraph(spec:DiagramSpec){
  const nodes=new Map<string,GNode>(),groups:GGroup[]=[],edges:GEdge[]=[];
  for(const tokens of spec.lines){
    const [head,...rest]=tokens;
    if(head==="node"){
      const id=rest.shift();
      if(!id||!/^[a-z][a-z0-9_-]*$/i.test(id))throw new Error(`Invalid node id in: ${tokens.join(" ")}`);
      if(nodes.has(id))throw new Error(`Duplicate node ${id}`);
      if(!isQuoted(rest[0]))throw new Error(`Node ${id} needs a quoted label`);
      const label=unquote(rest.shift()!);
      const sub=isQuoted(rest[0])?unquote(rest.shift()!):undefined;
      let kind:NodeKind="process",col=-1,row=-1;
      while(rest.length){
        const token=rest.shift()!;
        if(token==="at"){const [c,r]=(rest.shift()??"").split(",").map(Number);if(!Number.isInteger(c)||!Number.isInteger(r))throw new Error(`Node ${id}: use at COL,ROW`);col=c!;row=r!;}
        else if((nodeKinds as string[]).includes(token))kind=token as NodeKind;
        else throw new Error(`Node ${id}: unknown token ${token}`);
      }
      const node:GNode={id,label,sub,kind,col,row,w:0,h:0,x:0,y:0,labelLines:[],subLines:[],placed:col>=0};
      sizeNode(node);nodes.set(id,node);
    }else if(head==="group"){
      const id=rest.shift();
      if(!id||!isQuoted(rest[0]))throw new Error(`Group needs an id and a quoted label: ${tokens.join(" ")}`);
      const label=unquote(rest.shift()!);
      let kind:GroupKind="boundary";const members:string[]=[];
      for(const token of rest){if(["boundary","band","highlight"].includes(token))kind=token as GroupKind;else members.push(token);}
      if(!members.length)throw new Error(`Group ${id} has no members`);
      groups.push({id,label,members,kind});
    }else if(head==="edge"){
      const [from,arrow,to,...more]=rest;
      if(!from||!to||!["->","<->","--"].includes(arrow??""))throw new Error(`Edge syntax: edge a -> b "label" [style]: ${tokens.join(" ")}`);
      let label:string|undefined,style:EdgeStyle="solid";
      for(const token of more){if(isQuoted(token))label=unquote(token);else if(["solid","dashed","accent","muted"].includes(token))style=token as EdgeStyle;else throw new Error(`Edge ${from}->${to}: unknown token ${token}`);}
      edges.push({from,to,label,style,both:arrow==="<->",none:arrow==="--"});
    }else throw new Error(`Unknown graph statement: ${head}`);
  }
  for(const edge of edges)for(const id of [edge.from,edge.to])if(!nodes.has(id))throw new Error(`Edge refers to unknown node ${id}`);
  const groupIds=new Set(groups.map(group=>group.id));
  for(const group of groups)for(const member of group.members)if(!nodes.has(member)&&!groupIds.has(member))throw new Error(`Group ${group.id} refers to unknown ${member}`);
  return {nodes,groups,edges};
}

function autoPlace(nodes:Map<string,GNode>,edges:GEdge[],direction:"right"|"down"){
  const all=[...nodes.values()];
  const placed=all.filter(node=>node.placed);
  if(placed.length&&placed.length!==all.length)throw new Error("Place every node with `at C,R` or none of them");
  if(placed.length)return;
  // Longest-path ranks on the graph with DFS back edges ignored.
  const order=all.map(node=>node.id),out=new Map(order.map(id=>[id,[] as string[]]));
  for(const edge of edges)if(nodes.get(edge.from)!.kind!=="note"&&nodes.get(edge.to)!.kind!=="note")out.get(edge.from)!.push(edge.to);
  const state=new Map<string,number>(),back=new Set<string>();
  const visit=(id:string)=>{state.set(id,1);for(const next of out.get(id)!){if(state.get(next)===1)back.add(`${id}>${next}`);else if(!state.get(next))visit(next);}state.set(id,2);};
  for(const id of order)if(!state.get(id))visit(id);
  const rank=new Map(order.map(id=>[id,0]));
  for(let pass=0;pass<order.length;pass++)for(const id of order)for(const next of out.get(id)!)if(!back.has(`${id}>${next}`)&&rank.get(next)!<=rank.get(id)!)rank.set(next,rank.get(id)!+1);
  // Notes sit next to the node they annotate.
  for(const edge of edges){
    const from=nodes.get(edge.from)!,to=nodes.get(edge.to)!;
    if(from.kind==="note")rank.set(from.id,rank.get(to.id)!);
    if(to.kind==="note")rank.set(to.id,rank.get(from.id)!);
  }
  const layers=new Map<number,string[]>();
  for(const id of order){const r=rank.get(id)!;layers.set(r,[...(layers.get(r)??[]),id]);}
  const position=new Map<string,number>();
  for(const ids of layers.values())ids.forEach((id,index)=>position.set(id,index));
  const neighbours=(id:string)=>edges.flatMap(edge=>edge.from===id?[edge.to]:edge.to===id?[edge.from]:[]);
  for(let sweep=0;sweep<4;sweep++){
    for(const [, ids] of [...layers].sort((a,b)=>a[0]-b[0])){
      const score=(id:string)=>{const ns=neighbours(id).filter(other=>rank.get(other)!<rank.get(id)!||sweep%2===1);return ns.length?ns.reduce((sum,other)=>sum+position.get(other)!,0)/ns.length:position.get(id)!;};
      ids.sort((a,b)=>score(a)-score(b)||order.indexOf(a)-order.indexOf(b)).forEach((id,index)=>position.set(id,index));
    }
  }
  const widest=Math.max(...[...layers.values()].map(ids=>ids.length));
  for(const [r,ids] of layers){
    const offset=Math.floor((widest-ids.length)/2);
    for(const id of ids){
      const node=nodes.get(id)!,p=position.get(id)!+offset;
      if(direction==="right"){node.col=r;node.row=p;}else{node.col=p;node.row=r;}
    }
  }
}

const GAP_X=72, GAP_Y=58, MARGIN=26;

function layoutGraph(spec:DiagramSpec):Scene {
  const {nodes,groups,edges}=parseGraph(spec);
  autoPlace(nodes,edges,spec.direction);
  const list=[...nodes.values()];
  const cols=Math.max(...list.map(node=>node.col))+1,rows=Math.max(...list.map(node=>node.row))+1;
  const seen=new Set<string>();
  for(const node of list){const key=`${node.col},${node.row}`;if(seen.has(key))throw new Error(`Two nodes share cell ${key}`);seen.add(key);}
  // Group nesting depth per cell side decides extra padding so frames never touch nodes.
  const groupMembers=(group:GGroup):GNode[]=>group.members.flatMap(member=>nodes.get(member)?[nodes.get(member)!]:groupMembers(groups.find(g=>g.id===member)!));
  const bands=groups.filter(group=>group.kind==="band");
  const bandGutter=bands.length?Math.max(...bands.map(band=>textWidth(band.label.toUpperCase(),11,{font:"mono"})))+30:0;
  const colW=Array.from({length:cols},(_,c)=>Math.max(40,...list.filter(node=>node.col===c).map(node=>node.w)));
  const rowH=Array.from({length:rows},(_,r)=>Math.max(30,...list.filter(node=>node.row===r).map(node=>node.h)));
  const titleSpace=groups.some(group=>group.kind!=="band")?18:0;
  // Gaps widen so a label between two neighbours never sits on a node.
  const gapX=Array.from({length:cols},()=>GAP_X),gapY=Array.from({length:rows},()=>GAP_Y+titleSpace);
  for(const edge of edges){
    if(!edge.label)continue;
    const a=nodes.get(edge.from)!,b=nodes.get(edge.to)!;
    if(a.row===b.row&&Math.abs(a.col-b.col)===1){const c=Math.min(a.col,b.col);gapX[c]=Math.max(gapX[c]!,Math.min(textWidth(edge.label,12),120)+36);}
    if(a.col===b.col&&Math.abs(a.row-b.row)===1){const r=Math.min(a.row,b.row);gapY[r]=Math.max(gapY[r]!,wrap(edge.label,12,150).length*15+30+titleSpace);}
  }
  const colX:number[]=[],rowY:number[]=[];
  let x=MARGIN+bandGutter;for(let c=0;c<cols;c++){colX.push(x);x+=colW[c]!+gapX[c]!;}
  let y=MARGIN+titleSpace;for(let r=0;r<rows;r++){rowY.push(y);y+=rowH[r]!+gapY[r]!;}
  const width=x-gapX[cols-1]!+MARGIN,height=y-gapY[rows-1]!+MARGIN;
  for(const node of list){node.x=colX[node.col]!+(colW[node.col]!-node.w)/2;node.y=rowY[node.row]!+(rowH[node.row]!-node.h)/2;}
  const shapes:Shape[]=[];
  // Groups: bands first (full width), then boundaries from the outermost.
  const depth=(group:GGroup):number=>{const parent=groups.find(other=>other.members.includes(group.id));return parent?depth(parent)+1:0;};
  const frames=groups.map(group=>{
    const members=groupMembers(group);
    const inner=Math.max(0,...groups.filter(other=>other!==group&&groupMembers(other).every(node=>members.includes(node))&&depth(other)>depth(group)).map(other=>depth(other)-depth(group)));
    const pad=14+inner*12;
    const left=Math.min(...members.map(node=>node.x))-pad,right=Math.max(...members.map(node=>node.x+node.w))+pad;
    const top=Math.min(...members.map(node=>node.y))-pad-(group.kind==="band"?0:16),bottom=Math.max(...members.map(node=>node.y+node.h))+pad;
    return {group,left,right,top,bottom,level:depth(group)};
  });
  for(const frame of frames.filter(frame=>frame.group.kind==="band")){
    const top=Math.min(...groupMembers(frame.group).map(node=>rowY[node.row]!))-16,bottom=Math.max(...groupMembers(frame.group).map(node=>rowY[node.row]!+rowH[node.row]!))+16;
    shapes.push({type:"rect",x:8,y:top,w:width-16,h:bottom-top,r:4,fill:C.panel,stroke:C.panel,sw:1});
    shapes.push({type:"text",x:20,y:(top+bottom)/2,lines:wrap(frame.group.label.toUpperCase(),11,bandGutter-24,{font:"mono"}),size:11,weight:500,fill:C.muted,anchor:"start",font:"mono",lineHeight:14});
  }
  for(const frame of frames.filter(frame=>frame.group.kind!=="band").sort((a,b)=>a.level-b.level)){
    const highlight=frame.group.kind==="highlight";
    shapes.push({type:"rect",x:frame.left,y:frame.top,w:frame.right-frame.left,h:frame.bottom-frame.top,r:8,fill:highlight?C.soft:frame.level%2?C.panel:C.surface,stroke:highlight?C.accent:C.muted,sw:1.2,dash:true});
    shapes.push({type:"text",x:frame.left+12,y:frame.top+13,lines:[frame.group.label.toUpperCase()],size:10.5,weight:500,fill:highlight?C.accent:C.muted,anchor:"start",font:"mono"});
  }
  // Edges route through the gaps between cells.
  const boxes=list.map(node=>({id:node.id,x1:node.x-5,y1:node.y-5,x2:node.x+node.w+5,y2:node.y+node.h+5}));
  // Number of node boxes a route crosses; a segment may touch only the node it starts or ends at.
  const hits=(points:[number,number][],from:string,to:string)=>{
    let count=0;
    for(let i=0;i<points.length-1;i++){
      const [ax,ay]=points[i]!,[bx,by]=points[i+1]!;
      for(const box of boxes){
        if(i===0&&box.id===from||i===points.length-2&&box.id===to)continue;
        const minX=Math.min(ax,bx),maxX=Math.max(ax,bx),minY=Math.min(ay,by),maxY=Math.max(ay,by);
        if(maxX>box.x1&&minX<box.x2&&maxY>box.y1&&minY<box.y2)count++;
      }
    }
    return count;
  };
  // Edges between the same two nodes run side by side instead of on top of each other.
  const pairKey=(edge:GEdge)=>[edge.from,edge.to].sort().join("|");
  const pairTotal=new Map<string,number>(),pairSeen=new Map<string,number>();
  for(const edge of edges)pairTotal.set(pairKey(edge),(pairTotal.get(pairKey(edge))??0)+1);
  const colGap=(c:number)=>c<0?colX[0]!-GAP_X/2:c>=cols-1?colX[cols-1]!+colW[cols-1]!+GAP_X/2:colX[c]!+colW[c]!+gapX[c]!/2;
  const rowGap=(r:number)=>r<0?rowY[0]!-GAP_Y/2-titleSpace/2:r>=rows-1?rowY[rows-1]!+rowH[rows-1]!+GAP_Y/2:rowY[r]!+rowH[r]!+gapY[r]!/2;
  const routed:{edge:GEdge;points:[number,number][]}[]=[];
  for(const edge of edges){
    const a=nodes.get(edge.from)!,b=nodes.get(edge.to)!;
    const key=pairKey(edge),seen=pairSeen.get(key)??0;pairSeen.set(key,seen+1);
    const offset=(seen-((pairTotal.get(key)??1)-1)/2)*16;
    const acx=a.x+a.w/2+offset,acy=a.y+a.h/2+offset,bcx=b.x+b.w/2+offset,bcy=b.y+b.h/2+offset;
    const side=(node:GNode,s:"l"|"r"|"t"|"b",along?:number):[number,number]=>s==="l"?[node.x,along??node.y+node.h/2+offset]:s==="r"?[node.x+node.w,along??node.y+node.h/2+offset]:s==="t"?[along??node.x+node.w/2+offset,node.y]:[along??node.x+node.w/2+offset,node.y+node.h];
    const candidates:[number,number][][]=[];
    const right=b.col>a.col,left=b.col<a.col,down=b.row>a.row,up=b.row<a.row;
    if(a.row===b.row&&a.col!==b.col)candidates.push([side(a,right?"r":"l"),side(b,right?"l":"r")]);
    if(a.col===b.col&&a.row!==b.row)candidates.push([side(a,down?"b":"t"),side(b,down?"t":"b")]);
    const overlapX=Math.max(a.x,b.x)+10<Math.min(a.x+a.w,b.x+b.w)-10;
    const overlapY=Math.max(a.y,b.y)+8<Math.min(a.y+a.h,b.y+b.h)-8;
    if(overlapX&&a.row!==b.row){const along=(Math.max(a.x,b.x)+Math.min(a.x+a.w,b.x+b.w))/2+offset;candidates.push([side(a,down?"b":"t",along),side(b,down?"t":"b",along)]);}
    if(overlapY&&a.col!==b.col){const along=(Math.max(a.y,b.y)+Math.min(a.y+a.h,b.y+b.h))/2+offset;candidates.push([side(a,right?"r":"l",along),side(b,right?"l":"r",along)]);}
    if(a.col!==b.col&&a.row!==b.row){
      candidates.push([side(a,right?"r":"l"),[bcx,acy],side(b,down?"t":"b")]);
      candidates.push([side(a,down?"b":"t"),[acx,bcy],side(b,right?"l":"r")]);
      for(const c of [right?a.col:a.col-1,right?b.col-1:b.col]){const gx=colGap(c);candidates.push([side(a,right?"r":"l"),[gx,acy],[gx,bcy],side(b,right?"l":"r")]);}
      for(const r of [down?a.row:a.row-1,down?b.row-1:b.row]){const gy=rowGap(r);candidates.push([side(a,down?"b":"t"),[acx,gy],[bcx,gy],side(b,down?"t":"b")]);}
    }
    // Detours through the lattice of gaps for blocked or backward edges.
    for(const r of [a.row-1,a.row,b.row-1,b.row])for(const c of [b.col-1,b.col,a.col-1,a.col]){
      const gy=rowGap(r),gx=colGap(c),ay=gy>acy?"b":"t",bx=gx>bcx?"r":"l";
      candidates.push([side(a,ay),[acx,gy],[gx,gy],[gx,bcy],side(b,bx)]);
      const ax=gx>acx?"r":"l",by=gy>bcy?"b":"t";
      candidates.push([side(a,ax),[gx,acy],[gx,gy],[bcx,gy],side(b,by)]);
    }
    const orthogonal=candidates.map(points=>points.filter((point,index)=>index===0||point[0]!==points[index-1]![0]||point[1]!==points[index-1]![1])).filter(points=>points.length>1&&points.every((point,index)=>index===0||point[0]===points[index-1]![0]||point[1]===points[index-1]![1]));
    const length=(points:[number,number][])=>points.slice(1).reduce((sum,point,index)=>sum+Math.abs(point[0]-points[index]![0])+Math.abs(point[1]-points[index]![1]),0);
    // Cost: crossing a node is never acceptable, running along another edge is bad, crossing one is
    // worth about a bend; then fewer bends, then the shorter path. Never a diagonal.
    const outside=(points:[number,number][])=>points.some(([x,y])=>x<MARGIN/2||y<MARGIN/2||x>width-MARGIN/2||y>height-MARGIN/2)?1:0;
    const cost=(points:[number,number][])=>hits(points,a.id,b.id)*1e7+outside(points)*5e6+edgeConflicts(points,[a.id,b.id],routed.map(route=>({points:route.points,ends:[route.edge.from,route.edge.to] as [string,string]})))+(points.length-2)*400+length(points);
    orthogonal.sort((p,q)=>cost(p)-cost(q));
    if(!orthogonal.length)throw new Error(`Cannot route ${edge.from} -> ${edge.to}`);
    routed.push({edge,points:orthogonal[0]!});
  }
  spreadPorts(routed,list);
  // Separate collinear overlapping segments so parallel edges stay readable.
  const segments:{route:number;index:number;vertical:boolean;at:number;from:number;to:number}[]=[];
  routed.forEach((route,r)=>route.points.slice(1).forEach((point,i)=>{
    const prev=route.points[i]!,vertical=prev[0]===point[0];
    segments.push({route:r,index:i,vertical,at:vertical?point[0]:point[1],from:Math.min(vertical?prev[1]:prev[0],vertical?point[1]:point[0]),to:Math.max(vertical?prev[1]:prev[0],vertical?point[1]:point[0])});
  }));
  const used:typeof segments=[];
  for(const segment of segments){
    const clash=used.filter(other=>other.route!==segment.route&&other.vertical===segment.vertical&&Math.abs(other.at-segment.at)<5&&other.from<segment.to-4&&segment.from<other.to-4);
    if(clash.length){
      const points=routed[segment.route]!.points,shift=(clash.length%2?1:-1)*Math.ceil(clash.length/2)*9;
      const first=segment.index,last=segment.index+1;
      const endpoint=first===0||last===points.length-1;
      if(!endpoint||points.length===2){
        for(const i of [first,last]){const p=points[i]!;points[i]=segment.vertical?[p[0]+shift,p[1]]:[p[0],p[1]+shift];}
        segment.at+=shift;
      }
    }
    used.push(segment);
  }
  for(const {edge,points} of routed){
    const stroke=edge.style==="accent"?C.accent:edge.style==="muted"?C.muted:C.ink;
    const note=nodes.get(edge.from)!.kind==="note"||nodes.get(edge.to)!.kind==="note";
    shapes.push({type:"poly",points,stroke:note?C.muted:stroke,sw:edge.style==="muted"||note?1.3:1.6,dash:edge.style==="dashed"||note,arrowEnd:!edge.none,arrowStart:edge.both,round:10});
  }
  for(const node of list)shapes.push(...drawNode(node));
  // Labels last, on top of lines. Each label tries spots along its own route and takes the one that
  // covers no node, no other label and as few other lines as possible (ties: the longest segment).
  const placed:{x1:number;y1:number;x2:number;y2:number}[]=[];
  const allSegments=routed.flatMap((route,index)=>segmentsOf(route.points).map(seg=>({...seg,route:index})));
  routed.forEach(({edge,points},routeIndex)=>{
    if(!edge.label)return;
    const key=pairKey(edge),paired=(pairTotal.get(key)??1)>1,first=edges.filter(other=>pairKey(other)===key).indexOf(edge)===0;
    const spots:{cx:number;cy:number;lines:string[];w:number;h:number;len:number}[]=[];
    points.slice(1).forEach((point,i)=>{
      const [ax,ay]=points[i]!,[bx,by]=point,len=Math.abs(bx-ax)+Math.abs(by-ay);
      if(len<24)return;
      const lines=wrap(edge.label!,12,ax===bx?140:Math.min(140,Math.max(90,Math.abs(bx-ax)-18)));
      const w=Math.max(...lines.map(line=>textWidth(line,12)))+10,h=lines.length*15+6;
      for(const t of [.5,.3,.7]){
        let cx=ax+(bx-ax)*t,cy=ay+(by-ay)*t;
        if(paired&&ax===bx)cx+=first?-(w/2+4):w/2+4;
        if(paired&&ay===by)cy+=first?-(h/2+2):h/2+2;
        spots.push({cx,cy,lines,w,h,len:len*(t===.5?1:.8)});
      }
    });
    if(!spots.length)return;
    const score=(spot:typeof spots[number])=>{
      const box={x1:spot.cx-spot.w/2,y1:spot.cy-spot.h/2,x2:spot.cx+spot.w/2,y2:spot.cy+spot.h/2};
      const overlap=(o:{x1:number;y1:number;x2:number;y2:number})=>box.x2>o.x1&&box.x1<o.x2&&box.y2>o.y1&&box.y1<o.y2;
      let cost=0;
      for(const node of list)if(overlap({x1:node.x,y1:node.y,x2:node.x+node.w,y2:node.y+node.h}))cost+=1e6;
      for(const other of placed)if(overlap(other))cost+=1e5;
      for(const seg of allSegments)if(seg.route!==routeIndex&&overlap({x1:seg.x1-1,y1:seg.y1-1,x2:seg.x2+1,y2:seg.y2+1}))cost+=1e3;
      return cost-spot.len;
    };
    const best=spots.reduce((a,b)=>score(b)<score(a)?b:a);
    placed.push({x1:best.cx-best.w/2,y1:best.cy-best.h/2,x2:best.cx+best.w/2,y2:best.cy+best.h/2});
    shapes.push({type:"rect",x:best.cx-best.w/2,y:best.cy-best.h/2,w:best.w,h:best.h,r:3,fill:C.surface,stroke:C.surface,sw:1});
    shapes.push({type:"text",x:best.cx,y:best.cy,lines:best.lines,size:12,weight:400,fill:edge.style==="accent"?C.accent:C.muted,anchor:"middle",font:"sans",lineHeight:15});
  });
  return {width,height,shapes};
}

type Seg={x1:number;y1:number;x2:number;y2:number;vertical:boolean};
function segmentsOf(points:[number,number][]):Seg[] {
  return points.slice(1).map((point,i)=>{const [x1,y1]=points[i]!,[x2,y2]=point;return {x1:Math.min(x1,x2),y1:Math.min(y1,y2),x2:Math.max(x1,x2),y2:Math.max(y1,y2),vertical:x1===x2};});
}
/** Crossings with already routed edges cost 450 each; running on top of one costs 5000. */
function edgeConflicts(points:[number,number][],ends:[string,string],others:{points:[number,number][];ends:[string,string]}[]):number {
  let cost=0;
  const mine=segmentsOf(points);
  const attached=(index:number,count:number,pair:[string,string])=>[...(index===0?[pair[0]]:[]),...(index===count-1?[pair[1]]:[])];
  for(const other of others){const segs=segmentsOf(other.points);segs.forEach((theirs,j)=>mine.forEach((seg,i)=>{
    // Two edges meeting the same node may share a trunk for now; their ports are spread afterwards.
    const theirNodes=attached(j,segs.length,other.ends);
    if(attached(i,mine.length,ends).some(node=>theirNodes.includes(node)))return;
    if(seg.vertical===theirs.vertical){
      const same=seg.vertical?Math.abs(seg.x1-theirs.x1)<6:Math.abs(seg.y1-theirs.y1)<6;
      const overlap=seg.vertical?Math.min(seg.y2,theirs.y2)-Math.max(seg.y1,theirs.y1):Math.min(seg.x2,theirs.x2)-Math.max(seg.x1,theirs.x1);
      if(same&&overlap>8)cost+=5000;
    }else{
      const v=seg.vertical?seg:theirs,h=seg.vertical?theirs:seg;
      if(v.x1>h.x1+2&&v.x1<h.x2-2&&h.y1>v.y1+2&&h.y1<v.y2-2)cost+=450;
    }
  }));}
  return cost;
}
/** Spreads several edge ends that meet one side of a node, so they do not share a point. */
function spreadPorts(routes:{points:[number,number][]}[],nodes:GNode[]):void {
  type End={route:number;first:boolean};
  const sides=new Map<string,End[]>();
  const sideOf=(node:GNode,[x,y]:[number,number])=>Math.abs(x-node.x)<1?"l":Math.abs(x-node.x-node.w)<1?"r":Math.abs(y-node.y)<1?"t":Math.abs(y-node.y-node.h)<1?"b":undefined;
  routes.forEach((route,index)=>{
    for(const first of [true,false]){
      const point=first?route.points[0]!:route.points.at(-1)!;
      const node=nodes.find(item=>point[0]>=item.x-1&&point[0]<=item.x+item.w+1&&point[1]>=item.y-1&&point[1]<=item.y+item.h+1);
      const side=node&&sideOf(node,point);
      if(node&&side)sides.set(`${node.id}:${side}`,[...(sides.get(`${node.id}:${side}`)??[]),{route:index,first}]);
    }
  });
  for(const [key,ends] of sides){
    if(ends.length<2)continue;
    const [id,side]=key.split(":") as [string,"l"|"r"|"t"|"b"];
    const node=nodes.find(item=>item.id===id)!;
    const horizontal=side==="t"||side==="b";
    // Order ends by where their line goes next, so spreading does not create crossings.
    const toward=(end:End)=>{const pts=routes[end.route]!.points;const far=end.first?pts[Math.min(2,pts.length-1)]!:pts[Math.max(0,pts.length-3)]!;return horizontal?far[0]:far[1];};
    ends.sort((a,b)=>toward(a)-toward(b));
    const span=Math.min(horizontal?node.w-24:node.h-14,(ends.length-1)*(horizontal?26:14));
    ends.forEach((end,i)=>{
      const pts=routes[end.route]!.points;
      const centre=horizontal?node.x+node.w/2:node.y+node.h/2;
      const value=centre-span/2+(ends.length>1?span*i/(ends.length-1):0);
      const at=end.first?0:pts.length-1,next=end.first?1:pts.length-2;
      if(horizontal){pts[at]=[value,pts[at]![1]];if(pts.length>2||pts[next]![0]===pts[at]![0])pts[next]=[value,pts[next]![1]];}
      else{pts[at]=[pts[at]![0],value];if(pts.length>2||pts[next]![1]===pts[at]![1])pts[next]=[pts[next]![0],value];}
      if(pts.length===2){const [p,q]=pts as [[number,number],[number,number]];if(p[0]!==q[0]&&p[1]!==q[1]){if(horizontal)pts[end.first?1:0]=[value,(end.first?q:p)[1]];else pts[end.first?1:0]=[(end.first?q:p)[0],value];}}
    });
  }
}

function nodeText(node:GNode,cx:number,color:string=C.ink):Shape[] {
  const labelH=node.labelLines.length*18,subH=node.subLines.length?node.subLines.length*16+6:0;
  const top=node.y+node.h/2-(labelH+subH)/2+(node.kind==="store"?5:0);
  const shapes:Shape[]=[{type:"text",x:cx,y:top+labelH/2,lines:node.labelLines,size:LABEL,weight:600,fill:color,anchor:"middle",font:"sans",lineHeight:18}];
  if(node.subLines.length)shapes.push({type:"text",x:cx,y:top+labelH+6+(subH-6)/2,lines:node.subLines,size:SUB,weight:400,fill:C.muted,anchor:"middle",font:"sans",lineHeight:16});
  return shapes;
}

function drawNode(node:GNode):Shape[] {
  const {x,y,w,h}=node,cx=x+w/2;
  const pill=Math.min(h/2,22);
  switch(node.kind){
    case "note": return [{type:"text",x:cx,y:y+h/2,lines:node.labelLines,size:17,weight:400,fill:C.muted,anchor:"middle",font:"note",lineHeight:20}];
    case "store": {
      const ry=7;
      return [
        {type:"poly",points:[[x,y+ry],[x,y+h-ry],[x+w,y+h-ry],[x+w,y+ry]],stroke:C.ink,sw:1.5,fill:C.panel,closed:true},
        {type:"ellipse",cx,cy:y+h-ry,rx:w/2,ry,fill:C.panel,stroke:C.ink,sw:1.5},
        {type:"rect",x:x+.8,y:y+ry,w:w-1.6,h:h-2*ry,r:0,fill:C.panel,stroke:C.panel,sw:0},
        {type:"ellipse",cx,cy:y+ry,rx:w/2,ry,fill:C.surface,stroke:C.ink,sw:1.5},
        {type:"poly",points:[[x,y+ry],[x,y+h-ry]],stroke:C.ink,sw:1.5},
        {type:"poly",points:[[x+w,y+ry],[x+w,y+h-ry]],stroke:C.ink,sw:1.5},
        ...nodeText(node,cx),
      ];
    }
    case "entity": {
      const shapes:Shape[]=[
        {type:"rect",x,y,w,h,r:5,fill:C.surface,stroke:C.ink,sw:1.5},
        {type:"rect",x:x+.75,y:y+.75,w:w-1.5,h:30,r:4,fill:C.panel,stroke:C.panel,sw:0},
        {type:"poly",points:[[x,y+31],[x+w,y+31]],stroke:C.ink,sw:1.2},
        {type:"text",x:x+PAD_X,y:y+16,lines:[node.label],size:13.5,weight:700,fill:C.ink,anchor:"start",font:"mono"},
      ];
      node.subLines.forEach((field,index)=>shapes.push({type:"text",x:x+PAD_X,y:y+46+index*19,lines:[field],size:12,weight:400,fill:C.muted,anchor:"start",font:"mono"}));
      return shapes;
    }
    case "decision": {
      const k=14;
      return [{type:"poly",points:[[x+k,y],[x+w-k,y],[x+w,y+h/2],[x+w-k,y+h],[x+k,y+h],[x,y+h/2]],stroke:C.warning,sw:1.6,fill:C.surface,closed:true},...nodeText(node,cx)];
    }
    case "owner": return [{type:"rect",x,y,w,h,r:10,fill:C.soft,stroke:C.accent,sw:1.8},...nodeText(node,cx,C.accent)];
    case "actor": return [{type:"rect",x,y,w,h,r:12,fill:C.panel,stroke:C.ink,sw:1.8},...nodeText(node,cx)];
    case "external": return [{type:"rect",x,y,w,h,r:6,fill:C.surface,stroke:C.muted,sw:1.4,dash:true},...nodeText(node,cx)];
    case "state": return [{type:"rect",x,y,w,h,r:pill,fill:C.surface,stroke:C.ink,sw:1.5},...nodeText(node,cx)];
    case "start": return [{type:"rect",x,y,w,h,r:pill,fill:C.panel,stroke:C.ink,sw:2.6},...nodeText(node,cx)];
    case "end": return [{type:"rect",x,y,w,h,r:pill,fill:C.surface,stroke:C.success,sw:1.6},{type:"rect",x:x+3.5,y:y+3.5,w:w-7,h:h-7,r:Math.max(0,pill-3.5),fill:C.surface,stroke:C.success,sw:1.2},...nodeText(node,cx,C.success)];
    case "fail": return [{type:"rect",x,y,w,h,r:pill,fill:C.soft,stroke:C.accent,sw:1.6},...nodeText(node,cx,C.accent)];
    case "wait": return [{type:"rect",x,y,w,h,r:pill,fill:C.surface,stroke:C.warning,sw:1.6,dash:true},...nodeText(node,cx,C.warning)];
    default: return [{type:"rect",x,y,w,h,r:6,fill:C.surface,stroke:C.ink,sw:1.5},...nodeText(node,cx)];
  }
}

// ---------------------------------------------------------------- sequence engine

function layoutSequence(spec:DiagramSpec):Scene {
  type Actor={id:string;label:string;kind:NodeKind;x:number;w:number};
  type Step=
    |{type:"msg";from:string;to:string;label:string;style:EdgeStyle}
    |{type:"self";at:string;label:string}
    |{type:"note";at:string;label:string}
    |{type:"phase";label:string};
  const actors:Actor[]=[],steps:Step[]=[];
  for(const tokens of spec.lines){
    const [head,...rest]=tokens;
    if(head==="actor"){
      const [id,label,kind]=rest;
      if(!id||!isQuoted(label))throw new Error(`actor syntax: actor id "Label" [owner|external|store]`);
      actors.push({id,label:unquote(label!),kind:(kind as NodeKind|undefined)??"actor",x:0,w:0});
    }else if(head==="msg"){
      const [from,arrow,to,label,style]=rest;
      if(!from||!to||arrow!=="->"||!isQuoted(label))throw new Error(`msg syntax: msg a -> b "label" [dashed|accent|muted]`);
      steps.push({type:"msg",from,to,label:unquote(label!),style:(style as EdgeStyle|undefined)??"solid"});
    }else if(head==="self"||head==="note"){
      const [at,label]=rest;
      if(!at||!isQuoted(label))throw new Error(`${head} syntax: ${head} actor "text"`);
      steps.push({type:head,at,label:unquote(label!)});
    }else if(head==="phase"){
      if(!isQuoted(rest[0]))throw new Error(`phase syntax: phase "Label"`);
      steps.push({type:"phase",label:unquote(rest[0]!)});
    }else throw new Error(`Unknown sequence statement: ${head}`);
  }
  if(actors.length<2)throw new Error("A sequence needs at least two actors");
  const index=new Map(actors.map((actor,i)=>[actor.id,i]));
  for(const step of steps){
    const ids=step.type==="msg"?[step.from,step.to]:step.type==="phase"?[]:[step.at];
    for(const id of ids)if(!index.has(id))throw new Error(`Sequence refers to unknown actor ${id}`);
  }
  for(const actor of actors)actor.w=Math.max(104,textWidth(actor.label,14,{weight:600})+28);
  // Column gaps grow to fit the widest single-line-ish message between neighbours.
  const gaps=actors.slice(1).map((actor,i)=>Math.max(130,(actors[i]!.w+actor.w)/2+24));
  for(const step of steps){
    if(step.type!=="msg")continue;
    const a=index.get(step.from)!,b=index.get(step.to)!;
    const lo=Math.min(a,b),hi=Math.max(a,b);
    if(lo===hi)continue;
    const need=Math.min(textWidth(step.label,12.5),230)+34;
    const have=gaps.slice(lo,hi).reduce((sum,gap)=>sum+gap,0);
    if(have<need)for(let i=lo;i<hi;i++)gaps[i]!+= (need-have)/(hi-lo);
  }
  let x=MARGIN+actors[0]!.w/2;
  actors.forEach((actor,i)=>{if(i)x+=gaps[i-1]!;actor.x=x;});
  const width=x+actors.at(-1)!.w/2+MARGIN+60;
  const shapes:Shape[]=[];
  const headTop=MARGIN,headH=40;
  let y=headTop+headH+26;
  const body:Shape[]=[];
  for(const step of steps){
    if(step.type==="phase"){
      y+=6;
      body.push({type:"poly",points:[[MARGIN,y],[width-MARGIN,y]],stroke:C.muted,sw:1,dash:true});
      const w=textWidth(step.label.toUpperCase(),10.5,{font:"mono"})+14;
      body.push({type:"rect",x:MARGIN,y:y-9,w,h:18,r:3,fill:C.panel,stroke:C.panel,sw:1});
      body.push({type:"text",x:MARGIN+7,y,lines:[step.label.toUpperCase()],size:10.5,weight:500,fill:C.muted,anchor:"start",font:"mono"});
      y+=26;continue;
    }
    if(step.type==="msg"){
      const a=actors[index.get(step.from)!]!,b=actors[index.get(step.to)!]!;
      const span=Math.abs(b.x-a.x);
      const lines=wrap(step.label,12.5,Math.max(100,span-28));
      const labelH=lines.length*15;
      y+=labelH;
      const dir=b.x>a.x?1:-1;
      const stroke=step.style==="accent"?C.accent:step.style==="muted"?C.muted:C.ink;
      body.push({type:"text",x:(a.x+b.x)/2,y:y-labelH/2-5,lines,size:12.5,weight:400,fill:step.style==="accent"?C.accent:C.ink,anchor:"middle",font:"sans",lineHeight:15});
      body.push({type:"poly",points:[[a.x+dir*5,y],[b.x-dir*6,y]],stroke,sw:1.6,dash:step.style==="dashed"||step.style==="muted",arrowEnd:true});
      y+=24;continue;
    }
    const actor=actors[index.get(step.at)!]!;
    if(step.type==="self"){
      const i=index.get(step.at)!;
      const room=Math.min(i>0?gaps[i-1]!:200,i<gaps.length?gaps[i]!:200)*1.3;
      const max=Math.max(120,Math.min(240,room));
      const lines=wrap(step.label,12.5,max-20);
      const w=Math.max(...lines.map(line=>textWidth(line,12.5)))+22,h=lines.length*15+14;
      body.push({type:"rect",x:actor.x-w/2,y,w,h,r:5,fill:actor.kind==="owner"?C.soft:C.panel,stroke:actor.kind==="owner"?C.accent:C.ink,sw:1.3});
      body.push({type:"text",x:actor.x,y:y+h/2,lines,size:12.5,weight:400,fill:C.ink,anchor:"middle",font:"sans",lineHeight:15});
      y+=h+16;continue;
    }
    const lines=wrap(step.label,16,210,{font:"note"});
    body.push({type:"text",x:actor.x+12,y:y+lines.length*9,lines,size:16,weight:400,fill:C.muted,anchor:"start",font:"note",lineHeight:18});
    y+=lines.length*18+12;
  }
  const bottom=y+4;
  for(const actor of actors){
    shapes.push({type:"poly",points:[[actor.x,headTop+headH],[actor.x,bottom]],stroke:C.muted,sw:1,dash:true});
  }
  for(const actor of actors){
    const owner=actor.kind==="owner",external=actor.kind==="external";
    shapes.push({type:"rect",x:actor.x-actor.w/2,y:headTop,w:actor.w,h:headH,r:owner?10:6,fill:owner?C.soft:external?C.surface:C.panel,stroke:owner?C.accent:external?C.muted:C.ink,sw:1.6,dash:external});
    shapes.push({type:"text",x:actor.x,y:headTop+headH/2,lines:[actor.label],size:14,weight:600,fill:owner?C.accent:C.ink,anchor:"middle",font:"sans"});
  }
  shapes.push(...body);
  return {width,height:bottom+MARGIN,shapes};
}

// ---------------------------------------------------------------- timeline engine

function minutes(value:string):number {
  const match=value.match(/^(\d{1,2}):(\d{2})$/);
  if(!match)throw new Error(`Time must be HH:MM, got ${value}`);
  const total=Number(match[1])*60+Number(match[2]);
  if(total>24*60)throw new Error(`Time out of range: ${value}`);
  return total;
}

function layoutTimeline(spec:DiagramSpec):Scene {
  type Lane={id:string;label:string;items:({type:"at";t:number;label:string;accent:boolean}|{type:"span";from:number;to:number;label:string;accent:boolean}|{type:"every";step:number;from:number;label:string})[]};
  const lanes:Lane[]=[];let from=0,to=24*60;
  for(const tokens of spec.lines){
    const [head,...rest]=tokens;
    if(head==="range"){const [a,b]=(rest[0]??"").split("-");from=minutes(a!);to=minutes(b!);if(to<=from)throw new Error("range end must be after start");continue;}
    if(head==="lane"){if(!rest[0]||!isQuoted(rest[1]))throw new Error(`lane syntax: lane id "Label"`);lanes.push({id:rest[0],label:unquote(rest[1]!),items:[]});continue;}
    const lane=lanes.find(item=>item.id===rest[0]);
    if(!lane)throw new Error(`Timeline statement refers to unknown lane: ${tokens.join(" ")}`);
    if(head==="at"){if(!isQuoted(rest[2]))throw new Error(`at syntax: at lane HH:MM "label" [accent]`);lane.items.push({type:"at",t:minutes(rest[1]!),label:unquote(rest[2]!),accent:rest[3]==="accent"});}
    else if(head==="span"){const [a,b]=(rest[1]??"").split("-");if(!isQuoted(rest[2]))throw new Error(`span syntax: span lane HH:MM-HH:MM "label"`);lane.items.push({type:"span",from:minutes(a!),to:minutes(b!),label:unquote(rest[2]!),accent:rest[3]==="accent"});}
    else if(head==="every"){const step=Number((rest[1]??"").replace(/m$/,""));if(!step||!isQuoted(rest[2]))throw new Error(`every syntax: every lane 60m "label" [from HH:MM]`);lane.items.push({type:"every",step,from:rest[3]==="from"?minutes(rest[4]!):from,label:unquote(rest[2]!)});}
    else throw new Error(`Unknown timeline statement: ${head}`);
  }
  if(!lanes.length)throw new Error("A timeline needs lanes");
  const gutter=Math.min(190,Math.max(...lanes.map(lane=>textWidth(lane.label,13,{weight:600})))+34);
  const axisW=640,width=MARGIN+gutter+axisW+MARGIN;
  const px=(t:number)=>MARGIN+gutter+(t-from)/(to-from)*axisW;
  const shapes:Shape[]=[];
  const axisY=MARGIN+14;
  const hourStep=(to-from)/60>12?180:60;
  let y=axisY+26;
  const laneShapes:Shape[]=[];
  for(const lane of lanes){
    const rows:number[]=[];
    const placed:{x1:number;x2:number;row:number}[]=[];
    const labels:Shape[]=[],marks:Shape[]=[];
    for(const item of lane.items){
      if(item.type==="every"){
        for(let t=item.from;t<=to;t+=item.step)if(t>=from)marks.push({type:"poly",points:[[px(t),0],[px(t),10]],stroke:C.muted,sw:1.4});
        const w=textWidth(item.label,12)+10;
        const row=0;placed.push({x1:px(to)-w,x2:px(to),row});rows[row]=1;
        labels.push({type:"text",x:px(to),y:row,lines:[item.label],size:12,weight:400,fill:C.muted,anchor:"end",font:"sans"});
        continue;
      }
      const start=item.type==="at"?px(item.t):px(item.from),end=item.type==="at"?px(item.t):px(item.to);
      const text=item.type==="at"?`${String(Math.floor(item.t/60)).padStart(2,"0")}:${String(item.t%60).padStart(2,"0")} ${item.label}`:item.label;
      const w=textWidth(text,12.5)+10;
      const x1=start-4,x2=Math.max(end,start+w);
      let row=0;while(placed.some(p=>p.row===row&&p.x1<x2&&x1<p.x2))row++;
      placed.push({x1,x2,row});rows[row]=1;
      const color=item.accent?C.accent:C.ink;
      if(item.type==="at")marks.push({type:"rect",x:start-5,y:0,w:10,h:10,r:5,fill:item.accent?C.accent:C.surface,stroke:color,sw:1.8});
      else marks.push({type:"rect",x:start,y:0,w:Math.max(6,end-start),h:10,r:3,fill:item.accent?C.soft:C.panel,stroke:color,sw:1.5});
      labels.push({type:"text",x:start,y:row,lines:[text],size:12.5,weight:item.accent?600:400,fill:color,anchor:"start",font:"sans"});
    }
    const rowCount=Math.max(1,rows.length),laneH=24+rowCount*17+12;
    const markY=y+laneH-20;
    laneShapes.push({type:"rect",x:MARGIN,y,w:width-2*MARGIN,h:laneH,r:4,fill:lanes.indexOf(lane)%2?C.surface:C.panel,stroke:lanes.indexOf(lane)%2?C.surface:C.panel,sw:1});
    laneShapes.push({type:"text",x:MARGIN+12,y:y+laneH/2,lines:wrap(lane.label,13,gutter-24,{weight:600}),size:13,weight:600,fill:C.ink,anchor:"start",font:"sans",lineHeight:16});
    // Bars first, then ticks and points, so a span never hides a point in the same lane.
    marks.sort((a,b)=>(a.type==="rect"&&a.w>10?0:1)-(b.type==="rect"&&b.w>10?0:1));
    for(const mark of marks){
      if(mark.type==="rect")laneShapes.push({...mark,y:markY});
      else if(mark.type==="poly")laneShapes.push({...mark,points:mark.points.map(([x,dy])=>[x,markY+dy] as [number,number])});
    }
    for(const label of labels)if(label.type==="text")laneShapes.push({...label,y:y+14+label.y*17});
    y+=laneH+6;
  }
  for(let t=Math.ceil(from/hourStep)*hourStep;t<=to;t+=hourStep){
    shapes.push({type:"poly",points:[[px(t),axisY+10],[px(t),y-6]],stroke:C.muted,sw:.6,dash:true});
    shapes.push({type:"text",x:px(t),y:axisY,lines:[`${String(Math.floor(t/60)%24).padStart(2,"0")}:${String(t%60).padStart(2,"0")}`],size:11,weight:500,fill:C.muted,anchor:"middle",font:"mono"});
  }
  shapes.unshift(...laneShapes);
  // Axis ticks go on top of the lane backgrounds but under marks: reorder so lanes are first.
  return {width,height:y+MARGIN-6,shapes:[...laneShapes,...shapes.filter(shape=>!laneShapes.includes(shape))]};
}

// ---------------------------------------------------------------- entry points

export const MAX_DIAGRAM_WIDTH=980;
export type RenderedDiagram={svg:string;excalidraw:string;width:number;height:number;title:string;desc:string};

export function renderDiagram(source:string):RenderedDiagram {
  const spec=parseDiagram(source);
  const scene=spec.kind==="graph"?layoutGraph(spec):spec.kind==="sequence"?layoutSequence(spec):layoutTimeline(spec);
  // The article column is ~760px; wider pictures become unreadable on a laptop and need scrolling on a phone.
  if(scene.width>MAX_DIAGRAM_WIDTH)throw new Error(`Diagram "${spec.title??spec.desc.slice(0,40)}" is ${Math.round(scene.width)}px wide (max ${MAX_DIAGRAM_WIDTH}): use direction: down, place nodes on a narrower grid with at C,R, or shorten labels`);
  const title=spec.title??spec.desc;
  return {svg:toSvg(scene,title,spec.desc),excalidraw:toExcalidraw(scene),width:scene.width,height:scene.height,title:spec.title??"",desc:spec.desc};
}

/** Node ids of a diagram, used to check that the EN and RU versions draw the same picture. */
export function diagramSkeleton(source:string):string {
  const spec=parseDiagram(source);
  const ids=spec.lines.filter(tokens=>["node","actor","lane","group"].includes(tokens[0]!)).map(tokens=>`${tokens[0]}:${tokens[1]}`);
  return `${spec.kind}|${ids.sort().join(",")}`;
}
