# Editable diagram catalog

These are the spatial diagrams currently worth maintaining as Excalidraw scenes. Each language has an editable `.excalidraw` source and a static SVG served by the docs site. Other visual IDs in `content/schema.ts` render semantic HTML; they are not missing Excalidraw files by default.

| Visual ID | Source | Generated asset | Generator | Reader route |
| --- | --- | --- | --- | --- |
| `system-architecture` | `system-map-{en,ru}.excalidraw` | `../assets/system-map-{en,ru}.svg` | `node src/human-docs/diagrams/build-system-map.ts` | `system-map` |
| `daily-publication` | `daily-publication-{en,ru}.excalidraw` | `../assets/daily-publication-{en,ru}.svg` | `node src/human-docs/diagrams/build-daily-publication.ts` | `daily-lifecycle` |
| `project-run-state` | `project-run-state-{en,ru}.excalidraw` | `../assets/project-run-state-{en,ru}.svg` | `node src/human-docs/diagrams/build-project-run-state.ts` | `run-lifecycle` |
| `recovery-topology` | `recovery-topology-{en,ru}.excalidraw` | `../assets/recovery-topology-{en,ru}.svg` | `node src/human-docs/diagrams/build-recovery-topology.ts` | `recovery` |
| `project-path` | `project-path-{en,ru}.excalidraw` | `../assets/project-path-{en,ru}.svg` | `node src/human-docs/diagrams/build-project-path.ts` | `who-does-what` |

After editing a scene, regenerate both locales, check that text and arrows do not collide at desktop and narrow-phone widths, and retain the adjacent prose equivalent. Do not put private operational data in a scene, SVG or screenshot. A generated asset is not a substitute for browser QA or owner review.

Pages inline these SVGs through `inlineDiagram` in `src/ui-library/foundations/diagram.ts`: fixed colours map to the theme's `diagram-*` roles (the light value stays as fallback) and ids are namespaced, so scenes follow dark mode and page fonts. Author scenes only in the light diagram palette (`#ffffff`, `#faf8f2`, `#fff0ed`, `#0b0b0b`, `#5e5e59`, `#e21b16`); any other colour fails the docs build.
