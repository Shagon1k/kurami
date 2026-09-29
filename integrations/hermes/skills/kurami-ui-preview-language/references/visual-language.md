# Kurami UI visual language

## Character

Kurami UI combines a calm editorial page with utilitarian product controls and a small handwritten human layer. The visual ratio is approximately 70% disciplined editorial structure and 30% restrained fancy detail. A briefing is scan-first: it should expose useful information early, avoid ceremonial whitespace, and feel distinct without becoming noisy.

## Brand mark

The canonical browser mark is `src/ui-library/assets/brand/kurami-favicon.svg`: a broad digital
fox head in black, fox orange, and white on the warm paper surface. It is one
shared asset for Daily, Cinema, previews, and empty runtime states.

- Keep the supplied geometry and colors intact; do not recolor it for a page,
  theme, edition, or add-on.
- Link to the asset from the shared page renderer so new page types inherit it
  automatically.
- Do not replace it with a letter, emoji, generated illustration, or
  edition-specific icon.
- The thin square frame is part of the favicon asset and its silhouette fills
  the canvas deliberately so the fox stays legible at 16px.

The header uses the sibling `kurami-fox-transparent.png` in the same directory, extracted
from Alex's approved fox artwork. Its exterior is transparent; the black
outline, orange areas and white cheeks remain opaque. Do not replace white
cheeks with transparency. The framed favicon and unframed header asset have
different size/readability roles, not different identities.

## Typography

- Use **Onest** for display headings, body copy, controls, Cyrillic metadata, values, and mixed-language phrases.
- Use **Fragment Mono** only for short Latin-only technical labels, source names, timestamps made only of digits and punctuation, indices, and code-like metadata.
- Never split one semantic phrase between Onest and Fragment Mono. If Cyrillic appears anywhere in the phrase, render the whole phrase in Onest.
- Use **Caveat 600** only for Kurami Notes.
- Prefer sentence/title case. Reserve uppercase for micro-labels, compact categories, and short technical captions.
- Use comfortable heading line-height, normally 0.98–1.08 for large headings and at least 1.12 when Cyrillic wraps.
- Use Onest 600 for page and section headings by default. Reserve 700 for rare emphasis inside content, not the entire heading hierarchy.
- Controls and links use Onest 600, not 700 or 800.

Recommended fluid sizes:

| Role | Size | Line height |
|---|---:|---:|
| Page title | `clamp(2.5rem, 5.5vw, 4.75rem)` | `1.00–1.06` |
| Section title | `clamp(1.65rem, 3vw, 3rem)` | `1.04–1.12` |
| Card title | `clamp(1.1rem, 1.8vw, 1.55rem)` | `1.14–1.24` |
| Body | `1rem–1.125rem` | `1.5–1.65` |
| Metadata | `0.75rem–0.875rem` | `1.3–1.5` |
| Kurami Note | `1.25rem–1.625rem` | `1` |

## Colour roles

Colours are semantic roles defined in `src/ui-library/tokens/index.ts`; the
Kurami light and dark values live in `src/ui-library/themes/kurami.ts`. Read
values there, never copy them into a page.

| Role | Purpose |
|---|---|
| `surface-page` | Page background: near-white paper in light, near-black in dark |
| `surface-raised` | Quiet rows, inputs and buttons on the page |
| `surface-panel` | Warm grouping surface for callouts, disclosures and small panels |
| `surface-section` | Warmer framed section behind selected structural blocks |
| `text-primary` / `text-muted` | Ink and secondary text |
| `text-accent` | Accent-coloured text that must still pass AA on light surfaces |
| `text-on-accent` | Label on an accent fill |
| `border-default` / `border-subtle` | 1px rules and quieter grid lines |
| `accent-primary` / `accent-soft` | The red signal and its tinted background |
| `status-success` / `status-warning` / `status-failure` | Semantic state; always paired with text or an icon |
| `shadow-offset`, `focus-ring` | Offset shadow colour and keyboard focus |
| `chart-1` … `chart-5` | Chart series in order |
| `diagram-*` | The six-colour palette of explanatory diagrams |

Do not lower semantic alert text to decorative opacity. Backgrounds may be subtle; the label and message must remain readable.

## Surfaces and geometry

- Page background is near-white in light mode, not beige everywhere.
- Use the warmer `--surface-section` and `--surface-panel` roles to group sections.
- Default borders are 1px solid `--border-default`.
- Use `--radius-sm`, `--radius` or `--radius-md` (2–4px). Badges may use 5px. Search fields, filters, and compact segmented controls may be pills when ergonomically useful.
- Use `--shadow-card` (or `--shadow-card-sm`) for selected paper blocks only. A typical briefing should have no more than two or three shadowed structural blocks.
- Prefer whitespace and block contrast to repeated horizontal rules.
- Open editorial sections, compact strips, lists, and split panels may use no outer card at all.

## Spacing and layout

- Use a 4px base unit: `--space-1` … `--space-10` cover 4–40px; larger editorial gaps continue with 48, 64 and 96px.
- Keep the page reading width around 1200–1360px with responsive outer gutters.
- Use 16–24px gaps inside dense controls and 24–48px between content groups.
- Allow 48–96px between major editorial sections.
- In compact briefing mode prefer 28–56px between major sections and expose at least one useful content block in the first viewport.
- At narrow widths, collapse columns in reading order without dropping actions or metadata.

## Icons and controls

- Use one icon family and a consistent stroke weight.
- Standard icon size is 18–20px; use 16px only for secondary inline metadata.
- Center icons geometrically and optically inside at least 44×44px targets.
- Do not mix tiny search icons, oversized close marks, and unrelated symbol styles.
- A close control stays anchored at the top/right or center/right edge of its alert.

## Motion

- Motion is functional and brief: `--duration-fast` (150ms) or `--duration-base` (220ms) for colour, border, transform, and opacity.
- Avoid decorative looping animation.
- Respect `prefers-reduced-motion`.
- Chart points grow from 3px to 6px on hover/focus and expose a value tooltip.

## Kurami Notes

- Length: 1–4 words on every viewport.
- Purpose: focus, context, action, reassurance, or restrained humor.
- Frequency: render the caller-supplied set, normally 1–2 in a compact daily
  and up to 6 on a long feed when the producer derives the budget from item
  count, with no more than two jokes on a long page.
- Appearance: Caveat 600 in signal red. Rotation is optional, not the default for every note; vary geometry rather than color.
- Voice: Kurami is `она`; Russian grammar must use the feminine form where applicable.

Examples below illustrate brevity only and are not a reusable phrase pool:
`редкий тихий слот`, `можно позже`, `вот это главное`.

Avoid comments that duplicate nearby copy, pretend to know user intent, or make light of serious failures.

## Emoji

- Use familiar emoji when they make an action or compact state immediately clearer: `👍`, `👎`, `☀️`, `☔`, or `🎬` can be appropriate.
- Prefer emoji for like/dislike feedback over ambiguous up/down arrows.
- Keep UI labels and `aria-label` text explicit; emoji never replaces an accessible name.
- Normalize emoji inside the same 44px control geometry as icons.
- Do not scatter emoji through headings, summaries, or notes as generic decoration.
- Avoid mixing emoji and a second icon family for the same action.

## Topic labels

- Show one to four caller-supplied topics as quiet secondary metadata beneath the summary.
- Use muted text, a subtle border, a 4–5px radius, and little or no fill.
- Do not use the primary signal red as a topic fill; reserve it for actions and important state.
- Keep topic labels visually separate from provider, channel, timestamp, and other provenance.
- Preserve supplied spelling, casing, language, and order. Topic normalization belongs to the content-producing workflow.

## Accessibility

- Maintain WCAG AA contrast for text and controls.
- Never rely on color alone for status; combine it with a label, icon, or shape.
- Provide focus-visible styles with sufficient contrast and separation.
- Use semantic headings, landmarks, buttons, links, tables, and labels.
- Associate chart values and status indicators with accessible text.
- Keep touch and pointer targets at least 44×44px.
