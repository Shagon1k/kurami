// Semantic roles every Kurami theme must fill. Components read only these custom properties;
// a theme supplies values, never new names.
export const colorRoles=[
  "surface-page","surface-panel","surface-raised","surface-section",
  "text-primary","text-muted","text-accent","text-on-accent",
  "border-default","border-subtle",
  "accent-primary","accent-soft",
  "status-success","status-warning","status-failure",
  "shadow-offset","focus-ring",
] as const;
export type ColorRole=typeof colorRoles[number];
export type ThemeMode={colorScheme:"light"|"dark";colors:Record<ColorRole,string>};
export type Theme={name:string;light:ThemeMode;dark:ThemeMode};

// Mode-independent scales. Values are CSS lengths or font stacks, not colours.
export const typeface={
  "font-sans":'"Onest", system-ui, -apple-system, "Segoe UI", sans-serif',
  "font-mono":'"Fragment Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
  "font-note":'"Caveat", "Segoe Print", cursive',
} as const;
