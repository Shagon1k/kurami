// Semantic roles every Kurami theme must fill. Components read only these custom properties;
// a theme supplies values, never new names.
export const colorRoles=[
  "surface-page","surface-panel","surface-raised","surface-section",
  "text-primary","text-muted","text-accent","text-on-accent",
  "border-default","border-subtle",
  "accent-primary","accent-soft",
  "status-success","status-warning","status-failure","status-info",
  "shadow-offset","focus-ring",
  "chart-1","chart-2","chart-3","chart-4","chart-5",
  "diagram-surface","diagram-panel","diagram-ink","diagram-muted","diagram-accent","diagram-accent-soft",
] as const;
export type ColorRole=typeof colorRoles[number];
// Mode-independent roles: typefaces, shape, elevation, motion and spacing. A theme may change them too.
export const scaleRoles=[
  "font-sans","font-mono","font-note",
  "radius-sm","radius","radius-md",
  "shadow-card","shadow-card-sm","shadow-raised",
  "duration-fast","duration-base",
  "space-1","space-2","space-3","space-4","space-5","space-6","space-8","space-10",
] as const;
export type ScaleRole=typeof scaleRoles[number];
export type ThemeMode={colorScheme:"light"|"dark";colors:Record<ColorRole,string>};
export type Theme={name:string;scale:Record<ScaleRole,string>;light:ThemeMode;dark:ThemeMode};

// Layout breakpoints in px (max-width queries). Custom properties cannot drive media queries, so these are TS constants.
export const breakpoints={phone:620,tablet:900} as const;
