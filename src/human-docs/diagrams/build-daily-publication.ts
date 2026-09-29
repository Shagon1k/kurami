// Editable Excalidraw source and dependency-free public SVG share one layout.
import {writeFileSync} from "node:fs";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";

type Language="en"|"ru";
type Box={id:string;y:number;height:number;title:string;detail:string;accent?:boolean};
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const diagrams=resolve(root,"src/human-docs/diagrams");
const assets=resolve(root,"src/human-docs/assets");
const copy={
  en:{
    heading:"Daily · publication and recovery",
    boxes:[
      {id:"capture",y:78,height:100,title:"Capture + validate",detail:"News batch and edition evidence"},
      {id:"tail",y:231,height:100,title:"Technical tail",detail:"Media + bounded acknowledgement"},
      {id:"publish",y:384,height:100,title:"Publish",detail:"Edition becomes visible",accent:true},
      {id:"notify",y:537,height:100,title:"Notify",detail:"Durable Discord receipt"},
      {id:"before",y:728,height:112,title:"Before publication fails",detail:"Resume attempt; reuse News batch"},
      {id:"after",y:892,height:112,title:"Notification fails later",detail:"Keep edition; retry notification only"},
    ] as Box[],
    note:"A scheduler success is not a publication receipt.",
  },
  ru:{
    heading:"Daily · публикация и повторы",
    boxes:[
      {id:"capture",y:78,height:100,title:"Собрать + проверить",detail:"Пакет News и данные выпуска"},
      {id:"tail",y:231,height:100,title:"Технический этап",detail:"Медиа · подтверждение источника"},
      {id:"publish",y:384,height:100,title:"Опубликовать",detail:"Выпуск становится доступен",accent:true},
      {id:"notify",y:537,height:100,title:"Уведомить",detail:"Сохранённое подтверждение Discord"},
      {id:"before",y:728,height:112,title:"Сбой до публикации",detail:"Та же попытка; News не собирать"},
      {id:"after",y:892,height:112,title:"Сбой уведомления",detail:"Выпуск есть; повторить уведомление"},
    ] as Box[],
    note:"Успех планировщика ≠ публикация.",
  },
};
const xml=(s:string)=>s.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
const seed=(s:string)=>[...s].reduce((n,c)=>n+c.charCodeAt(0),0);
function base(id:string,type:string,x:number,y:number,width:number,height:number,extra:Record<string,unknown>={}){
  return {id,type,x,y,width,height,angle:0,strokeColor:"#0b0b0b",backgroundColor:"transparent",fillStyle:"solid",strokeWidth:2,strokeStyle:"solid",roughness:1,opacity:100,groupIds:[],frameId:null,roundness:null,seed:seed(id),version:1,versionNonce:seed(id)*19,isDeleted:false,boundElements:null,updated:0,link:null,locked:false,...extra};
}
function make(lang:Language){
  const data=copy[lang];
  const arrows:{id:string;points:[number,number][];tip?:boolean}[]=[
    {id:"capture-tail",points:[[280,178],[280,231]],tip:true},
    {id:"tail-publish",points:[[280,331],[280,384]],tip:true},
    {id:"publish-notify",points:[[280,484],[280,537]],tip:true},
    {id:"early-failure",points:[[68,128],[38,128],[38,784],[68,784]],tip:true},
    {id:"late-failure",points:[[492,587],[524,587],[524,948],[492,948]],tip:true},
  ];
  const elements=[base("heading","text",68,18,450,40,{text:data.heading,originalText:data.heading,fontSize:24,fontFamily:1,textAlign:"left",verticalAlign:"top",lineHeight:1.25,baseline:24,containerId:null,autoResize:true}),
    ...arrows.map(a=>{const x=Math.min(...a.points.map(p=>p[0])),y=Math.min(...a.points.map(p=>p[1]));return base(a.id,"arrow",x,y,Math.max(...a.points.map(p=>p[0]))-x,Math.max(...a.points.map(p=>p[1]))-y,{strokeColor:"#e21b16",points:a.points.map(([px,py])=>[px-x,py-y]),startBinding:null,endBinding:null,startArrowhead:null,endArrowhead:"arrow",elbowed:false});}),
    ...data.boxes.flatMap(b=>[base(`${b.id}-box`,"rectangle",68,b.y,424,b.height,{backgroundColor:b.accent?"#fff0ed":"#faf8f2",strokeColor:b.accent?"#e21b16":"#0b0b0b"}),base(`${b.id}-title`,"text",88,b.y+13,380,32,{text:b.title,originalText:b.title,fontSize:26,fontFamily:1,textAlign:"left",verticalAlign:"top",lineHeight:1.25,baseline:26,containerId:null,autoResize:true}),base(`${b.id}-detail`,"text",88,b.y+55,390,30,{text:b.detail,originalText:b.detail,fontSize:22,fontFamily:1,textAlign:"left",verticalAlign:"top",lineHeight:1.25,baseline:22,containerId:null,autoResize:true})]),
    base("note","text",68,1040,450,30,{text:data.note,originalText:data.note,fontSize:20,fontFamily:1,textAlign:"left",verticalAlign:"top",lineHeight:1.25,baseline:20,containerId:null,autoResize:true})];
  writeFileSync(resolve(diagrams,`daily-publication-${lang}.excalidraw`),JSON.stringify({type:"excalidraw",version:2,source:"https://excalidraw.com",elements,appState:{viewBackgroundColor:"#ffffff",gridSize:null},files:{}},null,2)+"\n");
  const line=(a:typeof arrows[number])=>`<polyline points="${a.points.map(([x,y])=>`${x},${y}`).join(" ")}" fill="none" stroke="#e21b16" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" marker-end="url(#tip)"/>`;
  const box=(b:Box)=>`<g><rect x="68" y="${b.y}" width="424" height="${b.height}" rx="7" fill="${b.accent?"#fff0ed":"#faf8f2"}" stroke="${b.accent?"#e21b16":"#0b0b0b"}" stroke-width="2"/><text x="88" y="${b.y+42}" font-size="26" font-weight="700">${xml(b.title)}</text><text x="88" y="${b.y+82}" font-size="22">${xml(b.detail)}</text></g>`;
  writeFileSync(resolve(assets,`daily-publication-${lang}.svg`),`<svg xmlns="http://www.w3.org/2000/svg" width="560" height="1100" viewBox="0 0 560 1100" role="img" aria-labelledby="title desc"><title id="title">${xml(data.heading)}</title><desc id="desc">${xml(data.note)}</desc><defs><marker id="tip" markerWidth="8" markerHeight="8" refX="6.5" refY="4" orient="auto"><path d="M1 1 L7 4 L1 7" fill="none" stroke="#e21b16" stroke-width="1.5"/></marker></defs><rect width="560" height="1100" fill="#fff"/><g font-family="Onest,Arial,sans-serif" fill="#0b0b0b"><text x="68" y="46" font-size="24" font-weight="700">${xml(data.heading)}</text>${arrows.map(line).join("")}${data.boxes.map(box).join("")}<text x="68" y="1065" font-size="20" fill="#5e5e59">${xml(data.note)}</text></g></svg>\n`);
}
for(const lang of ["en","ru"] as const)make(lang);
