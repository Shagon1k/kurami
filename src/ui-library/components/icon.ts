const paths={
  project:"M3 6h7l2 2h9v12H3zM3 6V4h7l2 2",
  ci:"M4 4h16v16H4zM8 12l3 3 5-6",
  preview:"M3 4h18v14H3zM8 22h8M12 18v4M3 8h18",
  refresh:"M20 7v5h-5M4 17v-5h5M5 7a8 8 0 0 1 14 0M19 17a8 8 0 0 1-14 0",
  chevronDown:"M6 9l6 6 6-6",
  work:"M8 6V4h8v2M3 7h18v13H3zM3 12h18M10 11v3h4v-3",
  review:"M9 3h6v3H9zM7 5H4v16h16V5h-3M8 13l3 3 5-6",
  alert:"M12 3 2 21h20zM12 9v5M12 17v1",
  commits:"M12 3v5M12 16v5M8 12a4 4 0 1 0 8 0 4 4 0 1 0-8 0",
  tokens:"M4 7c0-2 16-2 16 0s-16 2-16 0M4 7v10c0 2 16 2 16 0V7M4 12c0 2 16 2 16 0",
  cpu:"M6 6h12v12H6zM9 9h6v6H9zM9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4",
  ram:"M3 7h18v10H3zM6 10h3v4H6zM15 10h3v4h-3zM6 17v3M10 17v3M14 17v3M18 17v3",
  network:"M3 8c5-5 13-5 18 0M6 11c3-3 9-3 12 0M9 14c2-2 4-2 6 0M12 18v1",
  disk:"M5 4h14l3 12v4H2v-4zM2 16h20M16 18h2",
  controls:"M4 7h16M4 17h16M8 4v6M16 14v6",
} as const;
export type IconName=keyof typeof paths;
export function iconPath(name:IconName):string{return paths[name];}
export function renderIcon(name:IconName):string{return `<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${paths[name]}"/></svg>`;}
export const ICON_CSS=`.ui-icon { width: 18px; height: 18px; flex: none; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }`;
