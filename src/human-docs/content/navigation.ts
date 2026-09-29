// Reader-facing navigation: sections in the top bar, groups (headings, not links) in the side menu.
// Every page appears in exactly one group, except the legacy routes listed below.
import type {Localized,Section} from "./schema.ts";

export type NavGroup={heading:Localized<string>;slugs:string[]};

export const sectionLabels:Record<Section,Localized<string>>={
  basics:{en:"Basics",ru:"Основы"},
  digest:{en:"Digest",ru:"Digest"},
  projects:{en:"Projects",ru:"Проекты"},
  operations:{en:"Operations",ru:"Эксплуатация"},
  docs:{en:"Docs",ru:"Документация"},
};

export const navigation:Record<Section,NavGroup[]>={
  basics:[
    {heading:{en:"Introduction",ru:"Введение"},slugs:["what-is-kurami","who-does-what"]},
    {heading:{en:"System",ru:"Система"},slugs:["system-map","reading-state","glossary"]},
  ],
  digest:[
    {heading:{en:"Daily",ru:"Daily"},slugs:["daily","for-me","daily-addons","signals","daily-lifecycle"]},
    {heading:{en:"Reviews",ru:"Обзоры"},slugs:["weekly","cinema"]},
    {heading:{en:"Markets",ru:"Рынки"},slugs:["stocks","stocks-discovery","investment-review"]},
  ],
  projects:[
    {heading:{en:"Runs",ru:"Запуски"},slugs:["project-orchestrator","project-admission","run-lifecycle"]},
    {heading:{en:"Review and control",ru:"Проверка и контроль"},slugs:["engineering-evidence","owner-controls"]},
    {heading:{en:"Planning",ru:"Планирование"},slugs:["project-digest"]},
  ],
  operations:[
    {heading:{en:"Monitoring",ru:"Наблюдение"},slugs:["health","scheduling"]},
    {heading:{en:"Data",ru:"Данные"},slugs:["recovery","maintenance"]},
    {heading:{en:"Authority",ru:"Полномочия"},slugs:["connector-authority","automation-boundaries"]},
  ],
  docs:[
    {heading:{en:"Interface",ru:"Интерфейс"},slugs:["ui-library"]},
  ],
};

/** Older comparison routes that stay reachable by URL but are not listed in the menu. */
export const unlistedRoutes=["weekly-cinema","stocks-review"];

export function groupOf(slug:string):{section:Section;group:NavGroup}|undefined {
  for(const [section,groups] of Object.entries(navigation) as [Section,NavGroup[]][])
    for(const group of groups)if(group.slugs.includes(slug))return {section,group};
  return undefined;
}
