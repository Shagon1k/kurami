---
name: kurami-ui-preview-language
description: Render pages in Kurami's fixed visual language.
license: private
metadata:
  version: 0.9.2
  author: Aliaksei Hurynovich with Hermes Agent
  hermes:
    tags:
      - ui
      - preview
      - design-system
      - kurami
    category: creative
    related_skills: []
---

# Kurami UI Preview Language Skill

Render prepared content as a coherent responsive web preview in Kurami's fixed visual language. This skill controls presentation only: it preserves the supplied facts, ordering, meaning, and state while choosing components, layout, typography, color, and interaction.

## When to Use

Use this skill when a task asks to:

- render a daily briefing, digest, report, dashboard, or media page;
- create or update a preview page that must match Kurami UI;
- make a new page visually consistent with existing Kurami pages;
- apply light and dark themes to prepared content;
- display actions, links, statuses, charts, sources, feedback, or media collections;
- restyle an existing page into Kurami UI without changing its data.

Do not use this skill to collect news, query services, rank stories, summarize sources, schedule jobs, persist preferences, mark messages read, or invent missing content. A separate task or skill must prepare the content payload first.

## Prerequisites

Before rendering, require:

1. A prepared content payload or an existing page whose content must be preserved.
2. A writable web project or explicit destination for the preview.
3. Enough state to distinguish real values from loading, empty, stale, partial, or error states.

Read these references before making visual decisions:

- `references/visual-language.md` for tokens, typography, themes, spacing, and accessibility.
- `references/components.md` for component selection and layout grammar.
- `references/content-contract.md` for the boundary between content and presentation.
- `references/implementation-recipes.md` for font imports, CSS recipes, responsive behavior, and the iteration sequence.
- `references/layout-archetypes.md` for density profiles and section composition.
- `references/kurami-notes.md` for semantic note roles, placement, and daily variation.

For Kurami Briefing pages, the production components in
`/home/shagon1k/_hermes/_kurami/app/src/briefing/ui/` are canonical. Use the
runtime renderer instead of hand-authoring known components. Inspect
`templates/reference/` only for a new target that cannot use the canonical
renderer; those files are a portable visual baseline, not a second component
implementation and not a source of facts or demo copy.

## How to Run

A calling task can say:

> Use `kurami-ui-preview-language` to render this prepared payload. Preserve all facts and ordering. Produce a responsive light/dark preview.

For a Hermes cron job, include this skill in the job's `skills` field and pass the completed payload in the prompt. The data-producing skill remains responsible for sources and editorial logic; this skill remains responsible for display.

For the configured Daily Briefing runtime, write only the validated payload and
run:

```text
$BRIEFING_NODE $BRIEFING_CLI render-preview --payload <payload.json>
```

This invokes the canonical deterministic renderer. Do not generate a parallel
HTML document, copy component markup into the prompt, or call the legacy
`prepare-preview --html` path for a normal briefing run.

Use Hermes file tools to inspect and edit the target project. Use the target project's normal verification commands only after checking its own instructions.

## Quick Reference

| Concern | Rule |
|---|---|
| Overall character | Editorial, precise, warm paper, black ink, red signal |
| Brand asset | Always use `assets/kurami-favicon.svg` as the site favicon |
| Body and headings | Onest |
| Technical Latin labels | Fragment Mono |
| Handwritten notes | Caveat 600 |
| Heading case | Sentence/title case; uppercase only for micro-labels |
| Surfaces | Warm framed metric/feed blocks, quiet white rows, tiny radius, offset shadow |
| Accent | Red for primary emphasis, not decoration everywhere |
| Kurami Notes | 1–4 words, useful, restrained, feminine voice in Russian |
| Collections | Repeatable and variable-count; never force one hero item |
| Long feeds | Paginate 10–12 items; never use `Show all` or a nested feed scrollbar |
| Topics | Render 1–4 caller-supplied canonical strings as quiet labels |
| Service scope | Keep components provider-agnostic; service names belong to payloads |
| Theme | Complete light/dark support with a visible switch |
| Responsive behavior | Same information and note limits on mobile and desktop |
| Density | Briefing compact; report standard; media visual |
| Emoji | Functional familiar symbols are welcome; decoration is restrained |
| Iteration order | Canvas → type → sections → components → interaction → themes → QA |

## Procedure

### 1. Inspect the content

- Identify the page's primary reading task.
- Separate facts, metadata, actions, feedback controls, and system state.
- Preserve the supplied hierarchy and ordering unless the user explicitly permits editorial changes.
- Record missing values as missing; do not silently fabricate replacements.

### 2. Select the layout grammar

- Choose the density profile from `references/layout-archetypes.md` before sizing anything.
- Compose the page from multiple approved section archetypes; do not wrap every section in the same warm card.
- Give every section one clear purpose and one dominant reading path.
- Use a restrained editorial grid; allow asymmetry only when it improves hierarchy.
- Keep dense operational controls separate from calm reading content.
- Use repeatable grids, lists, or rails for any variable-size collection.
- Do not repeat the same section archetype more than twice in sequence.
- Keep source-management and technical diagnostics out of the default reader flow unless the payload explicitly requests them or data quality requires disclosure.

### 3. Map content to components

- Prefer canonical production components whenever the target runtime provides
  them. The agent supplies payload and composition intent; component markup,
  CSS, accessibility hooks, and runtime data attributes stay deterministic.
- In the Daily Briefing runtime, use `PaginatedFeed`, `NewsStory`, `TopicSet`,
  `StoryDisclosure`, `StoryCover`, `StoryMediaGallery`, `MediaLightbox`,
  `ReactionGroup`, `FeedOrderControl`, and `ThemeToggle` from the production UI layer. Do not
  recreate them with one-off HTML.
- Render the optional below-metrics Signals add-on only through canonical
  `SignalStrip` / `SignalItem`. Preserve supplied priority, fixed icon/color
  mapping, text and expiry. Show at most three; an empty or expired strip
  disappears. Never generate a different layout or extra signal copy per day.

- Use story rows for readable news items.
- When a story supplies canonical cached media, use the first image as a
  restrained cover that opens the lightbox. Render the complete supplied media
  set inside its disclosure: images open in the same lightbox and videos play
  inline with browser controls. On wide feed layouts, keep one stable cover
  track for every row so headlines align whether media exists or not; leave the
  track empty rather than fabricating a placeholder. Collapse that track at the
  mobile breakpoint. On mobile, retain the ordinal as a compact first-row lead-in
  and start the cover, metadata, copy, and actions on the following row across
  the full card width; do not reserve a permanent left rail beside story content.
  Do not hotlink provider-authenticated attachments.
- Keep disclosure media tiles a stable compact size. On wide layouts use four
  equal tracks: one or two assets occupy only their own tracks, while five or
  more wrap into additional rows. Reduce the track count responsively instead
  of stretching a small collection across the full detail width.
- Use a paginated Digest Feed for long collections of news, messages, updates, or saved items. Keep the feed generic; render provider names only from the payload.
- Render a Topic Set when the payload supplies canonical topic strings. Preserve the strings and order exactly; keep topics visually separate from source provenance.
- Use an Expandable Feed Item when the payload supplies an extended digest. Keep only one item expanded by default unless the caller explicitly requests comparison.
- Use a Bulk Source Action only when the payload supplies the exact label, scope, consequences, confirmation copy, handler, and resulting state. The component must not know how the source performs the action.
- Use canonical metric cards with value, label, delta or status, and useful context or period; do not reduce them to three isolated lines in an empty box.
- Use alerts for persistent state requiring attention, not for decorative callouts.
- Use badges and pills only for compact status or metadata.
- Use source tables only for explicit source management or diagnostics; use a compact quality disclosure in a normal briefing.
- Use canonical `ui/charts` primitives: `TrendChart` for meaningful time series,
  `BarChart` for period totals. Supply validated data, not generated SVG geometry.
  See the Charts contract in `references/components.md`.
- Use media collections for trailers, premieres, and currently playing titles.
- Represent loading, empty, stale, partial, and error states explicitly.
- For preference calibration, use the canonical `🔔` / `🔕` pair with
  accessible labels `Больше такого` / `Меньше такого`. It describes future
  feed preference rather than approval of the individual story.

### 4. Apply the visual language

- Use the exact token roles from `references/visual-language.md`.
- Link every rendered Kurami page to the canonical
  `assets/kurami-favicon.svg`. Do not generate edition-specific favicons or
  redraw the fox inside individual renderers.
- Start from the font imports and framework-neutral recipes in `references/implementation-recipes.md`; translate them into the target stack without changing token roles.
- Keep briefing headings compact enough for scan-first reading: section titles use Onest 600 and the page title must not exceed the approved fluid maximum.
- Set controls and links to Onest 600 and optically center their labels.
- Keep icon geometry consistent, centered, and at least 18px inside 44px targets.
- Prefer one-pixel borders and tiny radii. In the canonical briefing, frame the
  metric strip and digest feed with the warm section surface and a 3–5px offset
  shadow; keep story rows on the quieter surface inside the feed. Apply the
  shadow only to selected structural blocks, never to every row or section.
- Use red as a deliberate signal; do not turn the full page into a red interface.
- Kurami Notes are the deliberate exception: their handwritten text and marks
  always use the signal-red token in both themes.

### 5. Render supplied Kurami Notes sparingly

- Read `references/kurami-notes.md` and render only the notes supplied by the
  content producer. The renderer does not select copy from a built-in pool and
  does not add fallback phrases.
- Omit a supplied note if it violates the safety or length contract; otherwise
  preserve its text, target, semantic role, rotation, and mark. Render every
  Kurami Note in signal red; legacy payload `tone` values do not alter color.
- Keep each note to 1–4 words in Caveat 600.
- When multiple supplied notes exist, preserve at least two placement or style
  variants. Vary rotation, alignment, mark, or position rather than color.
- Use no more than two jokes on a long page and never place them on adjacent feed items.
- In Russian, refer to Kurami as `она` and write in a feminine voice where grammar exposes gender.
- Never joke about serious failures, safety, loss, emergencies, or personal distress.
- Never repeat the section heading or invent a fact.

### 6. Implement interaction and themes

- Put one visible theme control in the page utility header. It must use
  `data-theme-toggle` and may contain `data-theme-icon` and
  `data-theme-label`; never rely only on the browser color preference.
- Provide visible hover, focus-visible, active, disabled, and selected states.
- Make briefing read state explicit but quiet: use a subtle whole-row tint and
  a small red Caveat check mark, plus the screen-reader label `Прочитано`.
  Do not add a metadata pill, reduce text contrast, or grayscale media.
  Expanding the canonical story disclosure may set this state; it must remain
  possible to reopen and reread the story.
- Keep the utility header full-width with a padded page-shell inner container;
  its controls must never touch the structural border. Add the stronger border
  and small shadow only after scroll.
- Render every long-feed item with `data-feed-item` and its stable
  `data-item-id`. Use the canonical accessible disclosure pair:
  `button[data-story-toggle]` plus the matching region
  `[data-story-details]`, `data-edition-id`, and `data-item-id`. Keep the
  external source action in the same control group, while its destination
  remains semantically separate from the inline reading action.
- For a collection larger than its page size, include the runtime hooks
  `data-paginated-feed`, `data-feed-pagination`, `data-page-prev`,
  `data-page-next`, `data-page-status`, and the canonical mobile numeric jump
  `input[data-page-input]`. Keep the mobile input exactly the same 42px square
  as a numbered page button, clamp it to the available page range, and update
  it whenever arrows, desktop buttons, or URL state change. A printed `1 / 2`
  without working controls is invalid.
- Preserve pagination position in the URL or caller state when the target application supports it. After a page change, return focus or scroll position to the feed heading rather than the top of the full page.
- Use `FeedOrderControl` for Обзор / Для меня. The runtime supplies all order,
  evidence and explanation data; UI code must not calculate preferences or
  hide stories. Keep the same controls and explanation disclosure on mobile.
  Changing order resets pagination; reacting does not reshuffle the page.
- Keep long feeds page-bounded. Do not add `Show all`; do not place the primary reading feed inside an independently scrolling window.
- Give an expanded story the full available feed width. Use a neutral ink
  rule for ordinary reading; reserve red disclosure rules for error or urgent
  semantics.
- Use a minimum 44px pointer target for controls.
- Make chart nodes 3px at rest and 6px on hover or keyboard focus; reveal the exact value.
- Ensure dark semantic text stays bright enough: red, green, and amber must not become muddy.
- Preserve the same content, actions, and Kurami Note limits across breakpoints.

### 7. Verify the result

- Run the target project's normal build or validation command.
- Inspect representative desktop and mobile widths in light and dark mode.
- Check long Cyrillic headings, mixed numeric metadata, empty collections, and multiple media items.
- Fix visual regressions before declaring the preview complete.

## Pitfalls

- Do not use Fragment Mono for a phrase containing Cyrillic, including `12 мин назад`; use Onest for the whole phrase.
- Do not put every heading in uppercase.
- Do not use oversized display headlines that collide across lines.
- Do not mix font sizes or weights within one metric phrase without semantic reason.
- Do not overuse pills, rounded cards, soft shadows, doodles, or red fills.
- Do not wrap every section in the same bordered warm block or give every section the same title scale.
- Do not use thin, tiny icons or leave them optically off-center.
- Do not place a dismiss button in normal alert text flow; anchor it to the alert edge.
- Do not encode a trailer or premiere section as exactly one item.
- Do not render large media or premiere cards as mostly empty boxes when the payload contains visual, source, date, duration, or rating context.
- Do not hide missing, stale, or failed data behind a polished normal state.
- Do not copy demo facts, publication names, movie titles, or dates from reference templates.
- Do not hard-code Telegram, Gmail, RSS, or another provider into `Digest Feed`, pagination, reactions, or bulk-action primitives. Provider-specific copy is allowed only as supplied content or an explicitly labeled demo.
- Do not infer, merge, translate, rename, or normalize topics. Do not turn source labels into topics or render more than four visible topic labels per item.
- Do not render 100+ feed items in one document flow. Paginate long collections with a default page size of 10–12.
- Do not let this skill expand into fetching, ranking, summarization, preference learning, or scheduling.

## Verification

Before handoff, confirm all of the following:

- The page uses Onest, Fragment Mono only where allowed, and Caveat only for Kurami Notes.
- Light and dark themes use semantic tokens rather than isolated hard-coded colors.
- A visible `data-theme-toggle` changes the theme in the rendered runtime.
- Headings are readable, sentence case by default, and never collide.
- Buttons and links use weight 600 and appear vertically centered.
- Icons share consistent size, stroke, and alignment.
- Alerts, badges, metrics, tables, charts, and media collections match their component rules.
- The page uses more than one section archetype and matches the selected density profile.
- All interactive elements have keyboard focus and adequate hit areas.
- Emoji actions have accessible names and unmistakable selected states.
- Collections render zero, one, and many items without structural distortion.
- Long feeds expose pagination, inline expansion, source metadata, reaction state, and an external destination when supplied.
- Every feed item remains present in the document, every inline disclosure
  contains the caller-supplied details, and next/previous controls reach every
  page without a full reload.
- Topic labels preserve the caller's strings and order, remain secondary to the headline, and are not styled as primary red signals.
- Bulk actions show their exact scope and consequences, require confirmation when consequential, and have loading, success, and error states supplied by the caller.
- Kurami Notes respect the caller-supplied deterministic budget, attach to clear targets, always use signal red, and use multiple non-color placement variants when more than one is present.
- The content payload is unchanged in fact and meaning.
- The target project builds successfully and representative viewports were visually checked.
