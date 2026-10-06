// Semantic roles every Kurami theme must fill. Components read only these custom properties;
// a theme supplies values, never new names.
export const colorRoles=[
  "surface-page","surface-panel","surface-raised","surface-section",
  "text-primary","text-muted","text-accent","text-on-accent",
  "border-default","border-subtle",
  "accent-primary","accent-soft","accent-data",
  "status-success","status-warning","status-failure","status-info",
  "shadow-offset","focus-ring",
  "chart-1","chart-2","chart-3","chart-4","chart-5",
  "diagram-surface","diagram-panel","diagram-ink","diagram-muted","diagram-accent","diagram-accent-soft","diagram-success","diagram-warning",
] as const;
export type ColorRole=typeof colorRoles[number];
// Mode-independent roles: typefaces, shape, elevation, motion and spacing. A theme may change them too.
export const scaleRoles=[
  "font-sans","font-mono","font-note","font-display",
  // Display treatment for page titles, section headings and large figures.
  "display-case","display-tracking","display-glow",
  // Opted-in surfaces (data-ui-surface): bevel size of two corners and the lead-block glow (box-shadow).
  "panel-cut","panel-glow",
  "radius-sm","radius","radius-md","radius-pill",
  "shadow-card","shadow-card-sm","shadow-raised",
  "duration-fast","duration-base",
  "control-height",
  "space-1","space-2","space-3","space-4","space-5","space-6","space-8","space-10",
] as const;
export type ScaleRole=typeof scaleRoles[number];
export type ThemeMode={colorScheme:"light"|"dark";colors:Record<ColorRole,string>};
export type Theme={name:string;scale:Record<ScaleRole,string>;light:ThemeMode;dark:ThemeMode};
/** An additional theme applied over Paper with `html[data-kurami-theme="<name>"]`; it may support only some modes. */
export type ThemeVariant={name:string;label:string;scale:Record<ScaleRole,string>;modes:Partial<Record<"light"|"dark",ThemeMode>>};

// Layout breakpoints in px (max-width queries). Custom properties cannot drive media queries, so these are TS constants.
export const breakpoints={phone:620,tablet:900} as const;
