// Build the editable Excalidraw scenes and static, dependency-free SVGs together.
// Keep geometry and copy here so the shipped image cannot silently diverge.
import {mkdirSync,writeFileSync} from "node:fs";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";

type Language="en"|"ru";
type Step={id:string;actor:string;detail:string;owner?:boolean};
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const diagrams=resolve(root,"src/human-docs/diagrams");
const assets=resolve(root,"src/human-docs/assets");
const copy:Record<Language,{title:string;steps:Step[];note:string;note2:string}>={
  en:{
    title:"An engineering task, end to end",
    steps:[
      {id:"move",actor:"You",detail:"Move an issue into active work",owner:true},
      {id:"poll",actor:"Hermes and Kurami",detail:"The board poll sees the change"},
      {id:"admit",actor:"Kurami: admission",detail:"Issue, description, limits, resources"},
      {id:"provision",actor:"Kurami: controller",detail:"Own branch and worktree"},
      {id:"code",actor:"Codex",detail:"Writes code, opens a PR"},
      {id:"evidence",actor:"Kurami",detail:"CI and review on the exact commit"},
      {id:"decide",actor:"You",detail:"Review the PR and decide",owner:true},
    ],
    note:"Merging and deploying are always your call.",
    note2:"When something is unclear, the run stops and waits.",
  },
  ru:{
    title:"Путь инженерной задачи",
    steps:[
      {id:"move",actor:"Ты",detail:"Переводишь задачу в работу",owner:true},
      {id:"poll",actor:"Hermes и Курами",detail:"Опрос доски замечает переход"},
      {id:"admit",actor:"Курами: допуск",detail:"Задача, описание, лимиты, ресурсы"},
      {id:"provision",actor:"Курами: контроллер",detail:"Своя ветка и рабочая копия"},
      {id:"code",actor:"Codex",detail:"Пишет код и открывает PR"},
      {id:"evidence",actor:"Курами",detail:"CI и ревью на точном коммите"},
      {id:"decide",actor:"Ты",detail:"Смотришь PR и решаешь сам",owner:true},
    ],
    note:"Слияние и развёртывание — всегда твоё решение.",
    note2:"Если что-то неясно, запуск останавливается и ждёт.",
  },
};
const x=42,width=476,height=96,gap=22,top=70;
const yOf=(index:number)=>top+index*(height+gap);

const xml=(value:string)=>value.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
const seed=(value:string)=>[...value].reduce((sum,c)=>sum+c.charCodeAt(0),0);
function common(id:string,type:string,px:number,py:number,w:number,h:number,extra:Record<string,unknown>={}){
  return {id,type,x:px,y:py,width:w,height:h,angle:0,strokeColor:"#0b0b0b",backgroundColor:"transparent",fillStyle:"solid",strokeWidth:2,strokeStyle:"solid",roughness:1,opacity:100,groupIds:[],frameId:null,roundness:null,seed:seed(id),version:1,versionNonce:seed(id)*19,isDeleted:false,boundElements:null,updated:0,link:null,locked:false,...extra};
}
function textElement(id:string,value:string,px:number,py:number,fontSize:number,color="#0b0b0b"){
  return common(id,"text",px,py,480,fontSize+8,{strokeColor:color,text:value,originalText:value,fontSize,fontFamily:1,textAlign:"left",verticalAlign:"top",lineHeight:1.25,baseline:fontSize,containerId:null,autoResize:true});
}
function build(lang:Language){
  const words=copy[lang];
  const last=words.steps.length-1;
  const noteY=yOf(last)+height+36;
  const canvas=noteY+72;
  const arrows=words.steps.slice(0,-1).map((step,index)=>({id:`${step.id}-next`,from:yOf(index)+height,to:yOf(index+1)}));
  const elements=[
    textElement("title",words.title,x,20,23),
    ...arrows.map(arrow=>common(arrow.id,"arrow",280,arrow.from,0,arrow.to-arrow.from,{strokeColor:"#e21b16",points:[[0,0],[0,arrow.to-arrow.from]],startBinding:null,endBinding:null,startArrowhead:null,endArrowhead:"arrow",elbowed:false})),
    ...words.steps.flatMap((step,index)=>[
      common(`${step.id}-box`,"rectangle",x,yOf(index),width,height,{backgroundColor:step.owner?"#fff0ed":"#faf8f2",strokeColor:step.owner?"#e21b16":"#0b0b0b"}),
      textElement(`${step.id}-actor`,step.actor,x+18,yOf(index)+12,22,step.owner?"#e21b16":"#5e5e59"),
      textElement(`${step.id}-detail`,step.detail,x+18,yOf(index)+48,25),
    ]),
    textElement("note",words.note,x,noteY,20,"#5e5e59"),
    textElement("note-2",words.note2,x,noteY+34,20,"#5e5e59"),
  ];
  const scene={type:"excalidraw",version:2,source:"https://excalidraw.com",elements,appState:{viewBackgroundColor:"#ffffff",gridSize:null},files:{}};
  writeFileSync(resolve(diagrams,`project-path-${lang}.excalidraw`),JSON.stringify(scene,null,2)+"\n");
  const line=(arrow:{from:number;to:number})=>`<polyline points="280,${arrow.from} 280,${arrow.to-2}" fill="none" stroke="#e21b16" stroke-width="3" stroke-linecap="round" marker-end="url(#tip)"/>`;
  const box=(step:Step,index:number)=>`<g><rect x="${x}" y="${yOf(index)}" width="${width}" height="${height}" rx="7" fill="${step.owner?"#fff0ed":"#faf8f2"}" stroke="${step.owner?"#e21b16":"#0b0b0b"}" stroke-width="2"/><text x="${x+18}" y="${yOf(index)+34}" font-size="22" font-weight="700" fill="${step.owner?"#e21b16":"#5e5e59"}">${xml(step.actor)}</text><text x="${x+18}" y="${yOf(index)+74}" font-size="25">${xml(step.detail)}</text></g>`;
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="560" height="${canvas}" viewBox="0 0 560 ${canvas}" role="img" aria-labelledby="title desc"><title id="title">${xml(words.title)}</title><desc id="desc">${xml(words.note)} ${xml(words.note2)}</desc><defs><marker id="tip" markerWidth="8" markerHeight="8" refX="6.5" refY="4" orient="auto"><path d="M1 1 L7 4 L1 7" fill="none" stroke="#e21b16" stroke-width="1.5"/></marker></defs><rect width="560" height="${canvas}" fill="#fff"/><g font-family="Onest,Arial,sans-serif" fill="#0b0b0b"><text x="${x}" y="46" font-size="23" font-weight="700">${xml(words.title)}</text>${arrows.map(line).join("")}${words.steps.map(box).join("")}<text x="${x}" y="${noteY+24}" font-size="20" fill="#5e5e59">${xml(words.note)}</text><text x="${x}" y="${noteY+58}" font-size="20" fill="#5e5e59">${xml(words.note2)}</text></g></svg>\n`;
  writeFileSync(resolve(assets,`project-path-${lang}.svg`),svg);
}
mkdirSync(assets,{recursive:true});
for(const lang of ["en","ru"] as const)build(lang);
