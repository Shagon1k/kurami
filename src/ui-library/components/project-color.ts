import {projectColors,type ProjectColor} from "../tokens/index.ts";

// Project identity: each managed project has one library hue (config/projects.yaml `color:`), so its tasks
// stay recognisable in a mixed list. `project-color--<hue>` on any element sets `--project-color` and
// `--project-edge`, a 3px left bar as a box-shadow the product puts where its card edge is (a table row's
// first cell, a stacked row, a card). Neon lights the bar (themes/neon.ts). The hue is decoration: the
// project name stays in text next to it, and attention or selection keep their own background tints.
export function projectColorClass(color:ProjectColor):string{
  if(!(projectColors as readonly string[]).includes(color))throw new Error(`Unknown project color: ${color}`);
  return `project-color--${color}`;
}

export const PROJECT_COLOR_CSS=`
.project-color--blue { --project-color: var(--project-blue); }
.project-color--teal { --project-color: var(--project-teal); }
.project-color--green { --project-color: var(--project-green); }
.project-color--violet { --project-color: var(--project-violet); }
.project-color--pink { --project-color: var(--project-pink); }
.project-color--gold { --project-color: var(--project-gold); }
:is(${projectColors.map(color=>`.project-color--${color}`).join(", ")}) { --project-edge: inset 3px 0 0 var(--project-color); }
`;
