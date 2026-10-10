// Opt-in surfaces for themes that frame blocks (Neon). Paper draws nothing extra for them.
// "panel": a regular card or frame. "lead": the block the page leads with (VOLT-style neon frame).
// `attention` adds a slow pulse to a lead block that needs the owner.
export type SurfaceKind="panel"|"lead";

export function surfaceAttributes(kind:SurfaceKind,options:{attention?:boolean;quiet?:boolean}={}):string {
  return ` data-ui-surface="${kind}"${options.attention?" data-ui-attention":""}${options.quiet?' data-ui-surface-fill="quiet"':""}`;
}

/** Live regions: a theme may play a short scan when their content refreshes. */
export const LIVE_ATTRIBUTE=" data-ui-live";

/** A headline figure outside the stat card (a product's own metric tile): themes set it like a stat value. */
export const FIGURE_ATTRIBUTE=" data-ui-figure";
