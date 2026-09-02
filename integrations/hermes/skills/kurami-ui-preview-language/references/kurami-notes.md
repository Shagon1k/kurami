# Kurami Notes system

Kurami Notes add a small daily human layer without becoming decorative noise. They must be grounded in visible content, useful or genuinely charming, and varied enough that consecutive pages do not feel stamped from one template.

## Hard limits

- Render only caller-supplied notes. Compact pages normally contain 1–2;
  long feeds may contain up to 6 when the producing workflow explicitly
  budgets them from item count.
- Keep each note to 1–4 words.
- Use Caveat 600.
- Use at most two jokes on a long page and never on adjacent feed items.
- Use at least two placement variants on a page.
- Do not repeat the same rotation, color, alignment, and placement for all notes.
- Keep the same limits on mobile and desktop.

## Semantic roles

Choose different roles when possible:

- **Focus:** point to the most useful item or number.
- **Context:** explain why a supplied detail matters without adding a new fact.
- **Action:** suggest an available action such as open, postpone, or review.
- **Reassurance:** reduce anxiety around a harmless warning or busy schedule.
- **Personality:** add restrained humor grounded in the visible content.

Do not use two generic reassurance notes merely because there is empty space.

## Placement variants

### Margin note

Place in open whitespace beside the exact section or item it refers to. Connect it with a short arrow only when the target would otherwise be unclear.

### Metric annotation

Place near one specific value or delta, not above an entire metric grid. A note such as `Важное число` must visually identify which number is important.

### Inline aside

Place after a compact heading, metadata phrase, or action without rotation. Use ink color when red would compete with nearby signals.

### Underline or circle

Use a hand-drawn underline, bracket, or circle around a supplied word or value. The mark may carry no text when the target is self-explanatory.

### Between-block note

Place in a narrow transition between related sections. Use only when the note helps the reader understand the connection.

### Card-corner note

Attach to a specific card corner or visual. Do not repeat this placement on several cards in the same page.

## Style variants

Vary restrained properties, never all at once:

- signal red or normal ink;
- no rotation, slight negative rotation, or slight positive rotation;
- 18–28px size depending on context;
- text, text + arrow, underline, bracket, circle, or mark-only doodle;
- left, right, or centered alignment tied to the target.

Avoid large opaque backgrounds behind handwritten text. If contrast is needed, use a small paper scrap, underline, or ink stroke rather than a generic dark rectangle.

## Writing rules

- In Russian, Kurami is `она`; use feminine grammar where gender appears.
- Ground every note in supplied content.
- Prefer specific language over generic mood phrases.
- Do not repeat a heading, label, or obvious status.
- Do not invent priority, causality, preference, or user intention.
- Never joke about serious failures, safety, loss, emergencies, health, or personal distress.

Good patterns:

- `вот это главное →`
- `можно позже`
- `редкий тихий слот`
- `держу в уме`
- `🎬 на вечер?`
- a small circle around the most relevant supplied value with no text.

These are structural examples, not a phrase pool. Do not copy them merely to
fill a slot. The producing workflow authors fresh text after comparing the
retained edition history; the renderer owns only placement and styling.

Weak patterns:

- `Важное число` floating above several unrelated metrics;
- `Всё под контролем` when the page contains unresolved failures;
- `Кино зовёт` beside every cinema section;
- several two-word red notes all rotated by the same angle;
- comments added only because an area looks empty.

## Selection procedure

1. Validate that each supplied target exists after the layout is stable.
2. Preserve its supplied semantic role and treatment.
3. When multiple notes exist, vary placement or style and do not cluster them.
4. Omit invalid or unsafe notes instead of replacing them with generic copy.
5. Re-check overlaps and target clarity at mobile width.
