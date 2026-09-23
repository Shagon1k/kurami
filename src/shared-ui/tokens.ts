// Shared semantic visual language for Digest and human docs. Keep page-specific layout elsewhere.
export const SITE_TOKENS = `
:root {
  color-scheme: light;
  --paper: #fbfbf8;
  --surface: #ffffff;
  --section: #f1eee5;
  --panel: #faf8f2;
  --ink: #0b0b0b;
  --muted: #5e5e59;
  --signal: #e21b16;
  --line: #c9c3b7;
  --grid: #d8d8d1;
  --signal-soft: #fff0ed;
  --section-shadow: #d9d4c9;
  --positive: #147844;
  --warning: #9b5b00;
  --font-sans: "Onest", system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-mono: "Fragment Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
  --font-note: "Caveat", "Segoe Print", cursive;
}
html[data-theme="dark"] {
  color-scheme: dark;
  --paper: #0a0a0a;
  --surface: #111110;
  --section: #171714;
  --panel: #1d1d19;
  --ink: #f7f7f3;
  --muted: #aaa9a2;
  --signal: #ff4b45;
  --line: #44443e;
  --grid: #292927;
  --signal-soft: #2a1110;
  --section-shadow: #050505;
  --positive: #67e5a0;
  --warning: #ffd06e;
}
`;
