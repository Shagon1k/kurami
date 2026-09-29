// Editable Excalidraw scene and static SVG use the same bilingual layout.
import {writeFileSync} from "node:fs";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";

type Language="en"|"ru";
type Box={id:string;y:number;title:string;detail:string;accent?:boolean};
type Arrow={id:string;points:[number,number][]};
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const diagrams=resolve(root,"src/human-docs/diagrams");
const assets=resolve(root,"src/human-docs/assets");
const copy={
  en:{
    heading:"Run · states and safe stops",
    boxes:[
      {id:"admitted",y:80,title:"Admitted",detail:"Branch + worktree planned"},
      {id:"provisioned",y:230,title:"Provisioned",detail:"Isolated Git resources"},
      {id:"active",y:380,title:"Codex active",detail:"One managed CLI writer"},
      {id:"review",y:530,title:"Review-ready",detail:"CLI released · owner none"},
      {id:"stopping",y:680,title:"Stopping",detail:"Done or Cancel request",accent:true},
      {id:"released",y:865,title:"Released",detail:"Exact cleanup proof"},
      {id:"attention",y:1020,title:"Needs attention",detail:"Ambiguous work preserved",accent:true},
    ] as Box[],
    note:"No automatic merge or application deploy.",
  },
  ru:{
    heading:"Запуск · состояния и остановка",
    boxes:[
      {id:"admitted",y:80,title:"Допущен",detail:"Ветка и worktree запланированы"},
      {id:"provisioned",y:230,title:"Ресурсы готовы",detail:"Отдельные Git-ресурсы"},
      {id:"active",y:380,title:"Codex работает",detail:"Один управляемый CLI writer"},
      {id:"review",y:530,title:"Готов к ревью",detail:"CLI освобождён · owner none"},
      {id:"stopping",y:680,title:"Остановка",detail:"Запрос Done или Cancel",accent:true},
      {id:"released",y:865,title:"Освобождён",detail:"Очистка точно подтверждена"},
      {id:"attention",y:1020,title:"Нужен разбор",detail:"Неясная работа сохранена",accent:true},
    ] as Box[],
    note:"Нет автоматического merge или deploy приложения.",
  },
};
const arrows:Arrow[]=[
  {id:"admit-provision",points:[[280,174],[280,230]]},
  {id:"provision-active",points:[[280,324],[280,380]]},
  {id:"active-review",points:[[280,474],[280,530]]},
  {id:"review-stop",points:[[280,624],[280,680]]},
  {id:"stop-release",points:[[280,774],[280,865]]},
  {id:"cancel-stop",points:[[68,427],[38,427],[38,727],[68,727]]},
  {id:"unsafe-stop",points:[[492,727],[524,727],[524,1067],[492,1067]]},
];
const xml=(s:string)=>s.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
const seed=(s:string)=>[...s].reduce((n,c)=>n+c.charCodeAt(0),0);
function base(id:string,type:string,x:number,y:number,width:number,height:number,extra:Record<string,unknown>={}){
  return {id,type,x,y,width,height,angle:0,strokeColor:"#0b0b0b",backgroundColor:"transparent",fillStyle:"solid",strokeWidth:2,strokeStyle:"solid",roughness:1,opacity:100,groupIds:[],frameId:null,roundness:null,seed:seed(id),version:1,versionNonce:seed(id)*19,isDeleted:false,boundElements:null,updated:0,link:null,locked:false,...extra};
}
function make(lang:Language){
  const data=copy[lang];
  const elements=[
    base("heading","text",68,18,455,40,{text:data.heading,originalText:data.heading,fontSize:24,fontFamily:1,textAlign:"left",verticalAlign:"top",lineHeight:1.25,baseline:24,containerId:null,autoResize:true}),
    ...arrows.map(arrow=>{
      const x=Math.min(...arrow.points.map(point=>point[0]));
      const y=Math.min(...arrow.points.map(point=>point[1]));
      return base(arrow.id,"arrow",x,y,Math.max(...arrow.points.map(point=>point[0]))-x,Math.max(...arrow.points.map(point=>point[1]))-y,{strokeColor:"#e21b16",points:arrow.points.map(([px,py])=>[px-x,py-y]),startBinding:null,endBinding:null,startArrowhead:null,endArrowhead:"arrow",elbowed:false});
    }),
    ...data.boxes.flatMap(box=>[
      base(`${box.id}-box`,"rectangle",68,box.y,424,94,{backgroundColor:box.accent?"#fff0ed":"#faf8f2",strokeColor:box.accent?"#e21b16":"#0b0b0b"}),
      base(`${box.id}-title`,"text",88,box.y+11,384,34,{text:box.title,originalText:box.title,fontSize:25,fontFamily:1,textAlign:"left",verticalAlign:"top",lineHeight:1.25,baseline:25,containerId:null,autoResize:true}),
      base(`${box.id}-detail`,"text",88,box.y+51,384,30,{text:box.detail,originalText:box.detail,fontSize:20,fontFamily:1,textAlign:"left",verticalAlign:"top",lineHeight:1.25,baseline:20,containerId:null,autoResize:true}),
    ]),
    base("note","text",68,1157,455,30,{text:data.note,originalText:data.note,fontSize:19,fontFamily:1,textAlign:"left",verticalAlign:"top",lineHeight:1.25,baseline:19,containerId:null,autoResize:true}),
  ];
  writeFileSync(resolve(diagrams,`project-run-state-${lang}.excalidraw`),JSON.stringify({type:"excalidraw",version:2,source:"https://excalidraw.com",elements,appState:{viewBackgroundColor:"#ffffff",gridSize:null},files:{}},null,2)+"\n");
  const line=(arrow:Arrow)=>`<polyline points="${arrow.points.map(([x,y])=>`${x},${y}`).join(" ")}" fill="none" stroke="#e21b16" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" marker-end="url(#tip)"/>`;
  const box=(item:Box)=>`<g><rect x="68" y="${item.y}" width="424" height="94" rx="7" fill="${item.accent?"#fff0ed":"#faf8f2"}" stroke="${item.accent?"#e21b16":"#0b0b0b"}" stroke-width="2"/><text x="88" y="${item.y+39}" font-size="25" font-weight="700">${xml(item.title)}</text><text x="88" y="${item.y+75}" font-size="20">${xml(item.detail)}</text></g>`;
  writeFileSync(resolve(assets,`project-run-state-${lang}.svg`),`<svg xmlns="http://www.w3.org/2000/svg" width="560" height="1210" viewBox="0 0 560 1210" role="img" aria-labelledby="title desc"><title id="title">${xml(data.heading)}</title><desc id="desc">${xml(data.note)}</desc><defs><marker id="tip" markerWidth="8" markerHeight="8" refX="6.5" refY="4" orient="auto"><path d="M1 1 L7 4 L1 7" fill="none" stroke="#e21b16" stroke-width="1.5"/></marker></defs><rect width="560" height="1210" fill="#fff"/><g font-family="Onest,Arial,sans-serif" fill="#0b0b0b"><text x="68" y="46" font-size="24" font-weight="700">${xml(data.heading)}</text>${arrows.map(line).join("")}${data.boxes.map(box).join("")}<text x="68" y="1182" font-size="19" fill="#5e5e59">${xml(data.note)}</text></g></svg>\n`);
}
for(const lang of ["en","ru"] as const)make(lang);
