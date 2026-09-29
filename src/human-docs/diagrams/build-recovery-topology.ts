// Editable Excalidraw topology and its static SVG share one bilingual layout.
import {writeFileSync} from "node:fs";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";

type Language="en"|"ru";
type Box={id:string;x:number;y:number;w:number;h:number;title:string;lines:string[];accent?:boolean};
type Arrow={id:string;points:[number,number][]};
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const diagrams=resolve(root,"src/human-docs/diagrams");
const assets=resolve(root,"src/human-docs/assets");
const boxes:Record<Language,Box[]>={
  en:[
    {id:"git",x:40,y:90,w:220,h:145,title:"Private Git",lines:["Code · tests","Deploy assets"]},
    {id:"backup",x:300,y:90,w:220,h:145,title:"Local backup",lines:["SQLite · config","Manifest checked"]},
    {id:"offsite",x:300,y:290,w:220,h:155,title:"Off-site bundle",lines:["Encrypted · optional","Remote pair checked"],accent:true},
    {id:"host",x:40,y:515,w:480,h:125,title:"Restored host",lines:["Verify → explicit restore","No automatic session resume"]},
    {id:"external",x:40,y:700,w:220,h:145,title:"External controls",lines:["Services · clones","Rebuild and reconcile"]},
    {id:"excluded",x:300,y:700,w:220,h:145,title:"Not copied",lines:["Codex · worktrees","Docker · logs · old IDs"],accent:true},
  ],
  ru:[
    {id:"git",x:40,y:90,w:220,h:145,title:"Закрытый Git",lines:["Код · тесты","Без секретов"]},
    {id:"backup",x:300,y:90,w:220,h:145,title:"Локальная копия",lines:["SQLite · config","Манифест сверён"]},
    {id:"offsite",x:300,y:290,w:220,h:155,title:"Внешний архив",lines:["Шифрован · опция","Выгрузка сверена"],accent:true},
    {id:"host",x:40,y:515,w:480,h:125,title:"Новый узел",lines:["Проверить → явно вернуть","Без продолжения старых сессий"]},
    {id:"external",x:40,y:700,w:220,h:145,title:"Внешний контур",lines:["Сервисы · clones","Сверить заново"]},
    {id:"excluded",x:300,y:700,w:220,h:145,title:"Не копируется",lines:["Codex · worktrees","Docker · логи · ID"],accent:true},
  ],
};
const arrows:Arrow[]=[
  {id:"git-host",points:[[150,235],[150,515]]},
  {id:"backup-offsite",points:[[410,235],[410,290]]},
  {id:"backup-host",points:[[300,195],[280,195],[280,515]]},
  {id:"offsite-host",points:[[410,445],[410,515]]},
  {id:"host-external",points:[[150,640],[150,700]]},
];
const xml=(s:string)=>s.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
const seed=(s:string)=>[...s].reduce((n,c)=>n+c.charCodeAt(0),0);
function base(id:string,type:string,x:number,y:number,width:number,height:number,extra:Record<string,unknown>={}){
  return {id,type,x,y,width,height,angle:0,strokeColor:"#0b0b0b",backgroundColor:"transparent",fillStyle:"solid",strokeWidth:2,strokeStyle:"solid",roughness:1,opacity:100,groupIds:[],frameId:null,roundness:null,seed:seed(id),version:1,versionNonce:seed(id)*19,isDeleted:false,boundElements:null,updated:0,link:null,locked:false,...extra};
}
function textElement(id:string,value:string,x:number,y:number,width:number,size:number){
  return base(id,"text",x,y,width,size*1.4,{text:value,originalText:value,fontSize:size,fontFamily:1,textAlign:"left",verticalAlign:"top",lineHeight:1.25,baseline:size,containerId:null,autoResize:true});
}
function make(lang:Language){
  const heading=lang==="ru"?"Восстановление · источники и границы":"Recovery · sources and boundaries";
  const note=lang==="ru"?"Старые ID и preview ports не переносятся.":"Old IDs and preview ports are not restored.";
  const elements=[
    textElement("heading",heading,40,22,480,25),
    ...arrows.map(arrow=>{
      const x=Math.min(...arrow.points.map(point=>point[0]));
      const y=Math.min(...arrow.points.map(point=>point[1]));
      return base(arrow.id,"arrow",x,y,Math.max(...arrow.points.map(point=>point[0]))-x,Math.max(...arrow.points.map(point=>point[1]))-y,{strokeColor:"#e21b16",points:arrow.points.map(([px,py])=>[px-x,py-y]),startBinding:null,endBinding:null,startArrowhead:null,endArrowhead:"arrow",elbowed:false});
    }),
    ...boxes[lang].flatMap(box=>[
      base(`${box.id}-box`,"rectangle",box.x,box.y,box.w,box.h,{backgroundColor:box.accent?"#fff0ed":"#faf8f2",strokeColor:box.accent?"#e21b16":"#0b0b0b"}),
      textElement(`${box.id}-title`,box.title,box.x+15,box.y+14,box.w-30,22),
      ...box.lines.map((line,index)=>textElement(`${box.id}-line-${index}`,line,box.x+15,box.y+58+index*30,box.w-30,22)),
    ]),
    textElement("note",note,40,887,480,18),
  ];
  writeFileSync(resolve(diagrams,`recovery-topology-${lang}.excalidraw`),JSON.stringify({type:"excalidraw",version:2,source:"https://excalidraw.com",elements,appState:{viewBackgroundColor:"#ffffff",gridSize:null},files:{}},null,2)+"\n");
  const line=(arrow:Arrow)=>`<polyline points="${arrow.points.map(([x,y])=>`${x},${y}`).join(" ")}" fill="none" stroke="#e21b16" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" marker-end="url(#tip)"/>`;
  const box=(item:Box)=>`<g><rect x="${item.x}" y="${item.y}" width="${item.w}" height="${item.h}" rx="7" fill="${item.accent?"#fff0ed":"#faf8f2"}" stroke="${item.accent?"#e21b16":"#0b0b0b"}" stroke-width="2"/><text x="${item.x+15}" y="${item.y+43}" font-size="22" font-weight="700">${xml(item.title)}</text>${item.lines.map((line,index)=>`<text x="${item.x+15}" y="${item.y+79+index*30}" font-size="22">${xml(line)}</text>`).join("")}</g>`;
  writeFileSync(resolve(assets,`recovery-topology-${lang}.svg`),`<svg xmlns="http://www.w3.org/2000/svg" width="560" height="940" viewBox="0 0 560 940" role="img" aria-labelledby="title desc"><title id="title">${xml(heading)}</title><desc id="desc">${xml(note)}</desc><defs><marker id="tip" markerWidth="8" markerHeight="8" refX="6.5" refY="4" orient="auto"><path d="M1 1 L7 4 L1 7" fill="none" stroke="#e21b16" stroke-width="1.5"/></marker></defs><rect width="560" height="940" fill="#fff"/><g font-family="Onest,Arial,sans-serif" fill="#0b0b0b"><text x="40" y="55" font-size="25" font-weight="700">${xml(heading)}</text>${arrows.map(line).join("")}${boxes[lang].map(box).join("")}<text x="40" y="915" font-size="18" fill="#5e5e59">${xml(note)}</text></g></svg>\n`);
}
for(const lang of ["en","ru"] as const)make(lang);
