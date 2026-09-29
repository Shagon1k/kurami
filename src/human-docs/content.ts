// Section order is the reader-facing navigation order.
import {startPages} from "./content/start.ts";
import {understandPages} from "./content/understand.ts";
import {digestPages} from "./content/digest.ts";
import {projectPages} from "./content/projects.ts";
import {operationsPages} from "./content/operations.ts";
import {docsPages} from "./content/docs.ts";
import type {HumanDocsPage} from "./content/schema.ts";

export type {HumanDocsPage} from "./content/schema.ts";
export const pages:HumanDocsPage[]=[...startPages,...understandPages,...digestPages,...projectPages,...operationsPages,...docsPages];
