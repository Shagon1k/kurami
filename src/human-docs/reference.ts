// Reference tables generated from the repository at build time, so they cannot drift from the code.
// A page embeds one with ::generated{name="…"}. Descriptions of tables live here beside the generator:
// a migration that adds a table without a description fails the docs build.
import {readdirSync,readFileSync} from "node:fs";
import {resolve} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {renderTable} from "../ui-library/components/table.ts";
import {escapeText as escape} from "./markdown.ts";
import type {Language,Localized} from "./content/schema.ts";
import {tableNotes} from "./reference-notes.ts";

const root=resolve(import.meta.dirname,"../..");

type Column={name:string;values?:string[]};
type Table={name:string;columns:Column[];references:string[]};
export type Store="orchestrator"|"digest";
const storeDirs:Record<Store,string>={orchestrator:"migrations",digest:"migrations/briefing"};

const cache=new Map<Store,Table[]>();
/** Applies every migration of a store to an in-memory database and reads the final schema back. */
export function schema(store:Store):Table[] {
  const cached=cache.get(store);
  if(cached)return cached;
  const dir=resolve(root,storeDirs[store]);
  const db=new DatabaseSync(":memory:");
  for(const file of readdirSync(dir).filter(file=>file.endsWith(".sql")).sort())db.exec(readFileSync(resolve(dir,file),"utf8"));
  const tables=(db.prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as {name:string;sql:string}[]).map(row=>{
    const columns=(db.prepare(`PRAGMA table_info("${row.name}")`).all() as {name:string}[]).map(column=>{
      const check=row.sql.match(new RegExp(`CHECK\\s*\\(\\s*${column.name}\\s+IN\\s*\\(([^)]*)\\)`,"i"));
      const values=check?[...check[1]!.matchAll(/'([^']+)'/g)].map(match=>match[1]!):undefined;
      return {name:column.name,values:values?.length?values:undefined};
    });
    const references=[...new Set((db.prepare(`PRAGMA foreign_key_list("${row.name}")`).all() as {table:string}[]).map(key=>key.table))].filter(name=>name!==row.name);
    return {name:row.name,columns,references};
  });
  db.close();
  cache.set(store,tables);
  return tables;
}

const words={
  en:{table:"Table",purpose:"What it holds",columns:"Key columns",links:"Refers to",column:"Column",values:"Allowed values",more:"more"},
  ru:{table:"Таблица",purpose:"Что хранит",columns:"Ключевые колонки",links:"Ссылается на",column:"Колонка",values:"Допустимые значения",more:"ещё"},
};

function storeTable(store:Store,lang:Language):string {
  const t=words[lang];
  const rows=schema(store).map(table=>{
    const note=tableNotes[store][table.name];
    if(!note)throw new Error(`Docs reference: describe table ${table.name} (${store}) in src/human-docs/reference-notes.ts`);
    const shown=table.columns.filter(column=>!/^(created_at|updated_at)$/.test(column.name)).slice(0,6).map(column=>column.name);
    const rest=table.columns.length-2-shown.length;
    return [{html:`<code>${escape(table.name)}</code>`},note[lang],{html:`${shown.map(name=>`<code>${escape(name)}</code>`).join(", ")}${rest>0?` <span class="muted">+${rest} ${t.more}</span>`:""}`},{html:table.references.map(name=>`<code>${escape(name)}</code>`).join(", ")||"—"}];
  });
  for(const name of Object.keys(tableNotes[store]))if(!schema(store).some(table=>table.name===name))throw new Error(`Docs reference: ${name} is described but no ${store} migration creates it`);
  return renderTable({caption:store==="orchestrator"?"orchestrator.db":"briefing.db",captionHidden:true,columns:[t.table,t.purpose,t.columns,t.links],rows,rowHeaders:true,stack:true});
}

function stateTable(store:Store,lang:Language):string {
  const t=words[lang];
  const rows=schema(store).flatMap(table=>table.columns.filter(column=>column.values&&column.values.length>1&&!column.values.every(value=>/^\d+$/.test(value))).map(column=>[
    {html:`<code>${escape(table.name)}.${escape(column.name)}</code>`},
    {html:column.values!.map(value=>`<code>${escape(value)}</code>`).join(" · ")},
  ]));
  return renderTable({caption:store==="orchestrator"?"orchestrator.db":"briefing.db",captionHidden:true,columns:[t.column,t.values],rows,rowHeaders:true,stack:true});
}

const generators:Record<string,(lang:Language)=>string>={
  "orchestrator-tables":lang=>storeTable("orchestrator",lang),
  "digest-tables":lang=>storeTable("digest",lang),
  "orchestrator-states":lang=>stateTable("orchestrator",lang),
  "digest-states":lang=>stateTable("digest",lang),
};

export const generatedNames=Object.keys(generators);

export function generatedReference(name:string,lang:Language):string {
  const generator=generators[name];
  if(!generator)throw new Error(`Unknown generated reference "${name}" (known: ${generatedNames.join(", ")})`);
  return generator(lang);
}

export type {Localized};
