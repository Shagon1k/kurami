const paths={
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
  history:"M3 12a9 9 0 1 0 3-7M3 3v5h5M12 7v5l3 2",
  check:"M4 12l5 5L20 6",
  clock:"M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18M12 7v5l3 2",
  person:"M12 3a4 4 0 1 0 0 8 4 4 0 1 0 0-8M4 21v-2a8 8 0 0 1 16 0v2",
  bot:"M12 2v3M4 6h16v14H4zM8 10v2M16 10v2M8 16h8M1 10v6M23 10v6",
  arrow:"M6 18 18 6M8 6h10v10",
  database:"M4 6c0-4 16-4 16 0s-16 4-16 0M4 6v12c0 4 16 4 16 0V6M4 12c0 4 16 4 16 0",
  box:"M3 7 12 2l9 5v10l-9 5-9-5zM3 7l9 5 9-5M12 12v10",
  branch:"M6 3v13M6 16a3 3 0 1 0 0 6 3 3 0 1 0 0-6M17 2a3 3 0 1 0 0 6 3 3 0 1 0 0-6M17 8v2a6 6 0 0 1-6 6H6",
} as const;
export type IconName=keyof typeof paths;
export function iconPath(name:IconName):string{return paths[name];}
export function renderIcon(name:IconName):string{return `<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${paths[name]}"/></svg>`;}
export const ICON_CSS=`.ui-icon { width: 18px; height: 18px; flex: none; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }`;
