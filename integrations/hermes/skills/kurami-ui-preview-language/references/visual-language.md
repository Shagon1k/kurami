# Kurami UI visual language

## Character

Kurami UI combines a calm editorial page with utilitarian product controls and a small handwritten human layer. The visual ratio is approximately 70% disciplined editorial structure and 30% restrained fancy detail. A briefing is scan-first: it should expose useful information early, avoid ceremonial whitespace, and feel distinct without becoming noisy.

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

## Color tokens

Use semantic CSS custom properties. These approved values are the baseline.

### Light

```css
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
```

### Dark

```css
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
--semantic-red: #ff7771;
--semantic-green: #67e5a0;
--semantic-amber: #ffd06e;
```

Do not lower semantic alert text to decorative opacity. Backgrounds may be subtle; the label and message must remain readable.

## Surfaces and geometry

- Page background is near-white in light mode, not beige everywhere.
- Use the warmer `--section` and `--panel` colors to group sections.
- Default borders are 1px solid `--line`.
- Default radius is 0–4px. Badges may use 5px. Search fields, filters, and compact segmented controls may be pills when ergonomically useful.
- Use an understated 3–5px offset shadow in `--section-shadow` for selected paper blocks only. A typical briefing should have no more than two or three shadowed structural blocks.
- Prefer whitespace and block contrast to repeated horizontal rules.
- Open editorial sections, compact strips, lists, and split panels may use no outer card at all.

## Spacing and layout

- Use a 4px base unit with a practical spacing sequence of 4, 8, 12, 16, 24, 32, 48, 64, and 96px.
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

- Motion is functional and brief: 120–200ms for color, border, transform, and opacity.
- Avoid decorative looping animation.
- Respect `prefers-reduced-motion`.
- Chart points grow from 3px to 6px on hover/focus and expose a value tooltip.

## Kurami Notes

- Length: 1–4 words on every viewport.
- Purpose: focus, context, action, reassurance, or restrained humor.
- Frequency: exactly 2–3 per page unless the payload is stricter, with at most one joke.
- Appearance: Caveat 600, ink or signal color. Rotation is optional, not the default for every note.
- Voice: Kurami is `она`; Russian grammar must use the feminine form where applicable.

Good examples: `Важное число`, `Всё под контролем ↗`, `Стоит открыть`, `Без паники`, `Кино зовёт`.

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
