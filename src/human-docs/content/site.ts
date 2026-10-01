// Reader-facing structure: sections in the top bar, depth groups in the side menu, and old routes that
// still resolve. Page placement lives in each page's frontmatter (section, group, order).
import type {Localized} from "./schema.ts";

export const sections=["basics","digest","projects","platform","reference"] as const;
export type Section=typeof sections[number];

export const sectionLabels:Record<Section,Localized<string>>={
  basics:{en:"Overview",ru:"Обзор"},
  digest:{en:"Digest",ru:"Digest"},
  projects:{en:"Projects",ru:"Projects"},
  platform:{en:"Platform",ru:"Платформа"},
  reference:{en:"Reference",ru:"Справочник"},
};

/** Groups are depth layers: start with the overview, use the guide, go deeper in "How it works". */
export const groups=["start","guide","internals","decisions","reference"] as const;
export type Group=typeof groups[number];

export const groupLabels:Record<Group,Localized<string>>={
  start:{en:"Start here",ru:"Начало"},
  guide:{en:"Guide",ru:"Руководство"},
  internals:{en:"How it works",ru:"Как устроено"},
  decisions:{en:"Why it is so",ru:"Почему так"},
  reference:{en:"Reference",ru:"Справочник"},
};

/** Routes of the previous site. Each keeps working as a redirect to the page that now covers it. */
export const aliases:Record<string,string>={
  "system-map":"architecture",
  "reading-state":"state-and-truth",
  "daily-addons":"addons",
  "daily-lifecycle":"daily-pipeline",
  "stocks-discovery":"stocks",
  "weekly-cinema":"weekly",
  "stocks-review":"stocks",
  "docs-releases":"docs-system",
};

/** Every route the first site published. Each must stay a page or an alias: changelog entries and bookmarks use them. */
export const legacyRoutes=["what-is-kurami","who-does-what","system-map","reading-state","glossary","daily","for-me","daily-addons","signals","daily-lifecycle","weekly","cinema","stocks","stocks-discovery","investment-review","weekly-cinema","stocks-review","project-orchestrator","board-statuses","project-admission","run-lifecycle","engineering-evidence","previews","human-control","owner-controls","project-setup","settings","project-digest","health","scheduling","recovery","maintenance","connector-authority","access","automation-boundaries","docs-process","docs-releases","ui-library"];
