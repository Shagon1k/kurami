// Build the editable Excalidraw scenes and static, dependency-free SVGs together.
// Keep geometry and copy here so the shipped image cannot silently diverge.
import {mkdirSync,writeFileSync} from "node:fs";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";

type Language="en"|"ru";
type Box={id:string;x:number;y:number;width:number;height:number;label:string;detail:string;accent?:boolean};
type Arrow={id:string;points:[number,number][]};
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const diagrams=resolve(root,"src/human-docs/diagrams");
const assets=resolve(root,"src/human-docs/assets");
const copy={
  en:{
    title:"Two ways in · three workflows",
    boxes:[
      ["talk",42,70,476,102,"Owner request","Discord · via Hermes"],
      ["schedule",42,200,476,102,"Schedule or new data","An agent only when needed"],
      ["kurami",42,350,476,100,"Kurami rules","Checks · separate state",true],
      ["digest",102,535,416,96,"Digest","Dated editions · live sections"],
      ["projects",102,658,416,96,"Project Orchestrator","Engineering runs · review"],
      ["operations",102,781,416,96,"Operations","Health checks · backups"],
    ] as (string|number|boolean)[][],
    branch:"separate product workflows",
    note:"Each workflow keeps its own state.",
    note2:"Discord can show results and controls.",
  },
  ru:{
    title:"Два входа · три процесса",
    boxes:[
      ["talk",42,70,476,102,"Запрос владельца","Discord · через Hermes"],
      ["schedule",42,200,476,102,"Расписание или новые данные","Агент — только если нужен"],
      ["kurami",42,350,476,100,"Правила Курами","Проверки · отдельное состояние",true],
      ["digest",102,535,416,96,"Digest","Выпуски · живые блоки"],
      ["projects",102,658,416,96,"Project Orchestrator","Запуски · проверка работы"],
      ["operations",102,781,416,96,"Operations","Здоровье · резервные копии"],
    ] as (string|number|boolean)[][],
    branch:"отдельные процессы продуктов",
    note:"У каждого процесса своё состояние.",
    note2:"Discord может показать результат и действия.",
  },
} as const;

const xml=(value:string)=>value.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
const seed=(value:string)=>[...value].reduce((sum,c)=>sum+c.charCodeAt(0),0);
function common(id:string,type:string,x:number,y:number,width:number,height:number,extra:Record<string,unknown>={}){
  return {id,type,x,y,width,height,angle:0,strokeColor:"#0b0b0b",backgroundColor:"transparent",fillStyle:"solid",strokeWidth:2,strokeStyle:"solid",roughness:1,opacity:100,groupIds:[],frameId:null,roundness:null,seed:seed(id),version:1,versionNonce:seed(id)*19,isDeleted:false,boundElements:null,updated:0,link:null,locked:false,...extra};
}
function textElement(id:string,value:string,x:number,y:number,fontSize:number){
  return common(id,"text",x,y,480,fontSize+8,{text:value,originalText:value,fontSize,fontFamily:1,textAlign:"left",verticalAlign:"top",lineHeight:1.25,baseline:fontSize,containerId:null,autoResize:true});
}
function arrowElement(arrow:Arrow){
  const x=Math.min(...arrow.points.map(point=>point[0]));
  const y=Math.min(...arrow.points.map(point=>point[1]));
  const points=arrow.points.map(([px,py])=>[px-x,py-y]);
  return common(arrow.id,"arrow",x,y,Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1])),{strokeColor:"#e21b16",points,startBinding:null,endBinding:null,startArrowhead:null,endArrowhead:arrow.id==="boundary-to-branch"?null:"arrow",elbowed:false});
}
function build(lang:Language){
  const words=copy[lang];
  const boxes=words.boxes.map(([id,x,y,width,height,label,detail,accent])=>({id:String(id),x:Number(x),y:Number(y),width:Number(width),height:Number(height),label:String(label),detail:String(detail),accent:Boolean(accent)})) as Box[];
  const arrows:Arrow[]=[
    {id:"talk-to-boundary",points:[[518,121],[532,121],[532,330],[450,330],[450,350]]},
    {id:"schedule-to-boundary",points:[[330,302],[330,350]]},
    {id:"boundary-to-branch",points:[[70,450],[70,877]]},
    {id:"branch-digest",points:[[70,583],[102,583]]},
    {id:"branch-projects",points:[[70,706],[102,706]]},
    {id:"branch-operations",points:[[70,829],[102,829]]},
  ];
  // The branch trunk is a connector, not a lifecycle arrow between products.
  const elements=[
    textElement("title",words.title,42,20,23),
    ...arrows.map(arrowElement),
    ...boxes.flatMap(box=>[
      common(`${box.id}-box`,"rectangle",box.x,box.y,box.width,box.height,{backgroundColor:box.accent?"#fff0ed":"#faf8f2",strokeColor:box.accent?"#e21b16":"#0b0b0b"}),
      textElement(`${box.id}-label`,box.label,box.x+18,box.y+12,27),
      textElement(`${box.id}-detail`,box.detail,box.x+18,box.y+54,24),
    ]),
    textElement("branch-label",words.branch,102,481,21),
    textElement("note",words.note,42,920,20),
    textElement("note-2",words.note2,42,954,20),
  ];
  const scene={type:"excalidraw",version:2,source:"https://excalidraw.com",elements,appState:{viewBackgroundColor:"#ffffff",gridSize:null},files:{}};
  writeFileSync(resolve(diagrams,`system-map-${lang}.excalidraw`),JSON.stringify(scene,null,2)+"\n");
  const line=(arrow:Arrow)=>`<polyline points="${arrow.points.map(([x,y])=>`${x},${y}`).join(" ")}" fill="none" stroke="#e21b16" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"${arrow.id==="boundary-to-branch"?"":' marker-end="url(#tip)"'}/>`;
  const box=(item:Box)=>`<g><rect x="${item.x}" y="${item.y}" width="${item.width}" height="${item.height}" rx="7" fill="${item.accent?"#fff0ed":"#faf8f2"}" stroke="${item.accent?"#e21b16":"#0b0b0b"}" stroke-width="2"/><text x="${item.x+18}" y="${item.y+42}" font-size="27" font-weight="700">${xml(item.label)}</text><text x="${item.x+18}" y="${item.y+81}" font-size="24">${xml(item.detail)}</text></g>`;
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="560" height="1000" viewBox="0 0 560 1000" role="img" aria-labelledby="title desc"><title id="title">${xml(words.title)}</title><desc id="desc">${xml(words.note)} ${xml(words.note2)}</desc><defs><marker id="tip" markerWidth="8" markerHeight="8" refX="6.5" refY="4" orient="auto"><path d="M1 1 L7 4 L1 7" fill="none" stroke="#e21b16" stroke-width="1.5"/></marker></defs><rect width="560" height="1000" fill="#fff"/><g font-family="Onest,Arial,sans-serif" fill="#0b0b0b"><text x="42" y="46" font-size="23" font-weight="700">${xml(words.title)}</text>${arrows.map(line).join("")}${boxes.map(box).join("")}<text x="102" y="505" font-size="21" fill="#5e5e59">${xml(words.branch)}</text><text x="42" y="944" font-size="20" fill="#5e5e59">${xml(words.note)}</text><text x="42" y="978" font-size="20" fill="#5e5e59">${xml(words.note2)}</text></g></svg>\n`;
  writeFileSync(resolve(assets,`system-map-${lang}.svg`),svg);
}
mkdirSync(assets,{recursive:true});
for(const lang of ["en","ru"] as const)build(lang);
