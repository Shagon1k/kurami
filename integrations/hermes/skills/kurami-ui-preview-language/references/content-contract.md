# Content-to-presentation contract

## Responsibility boundary

The caller owns content and editorial decisions. This skill owns representation.

The caller supplies:

- page title, date, and locale;
- sections in intended order;
- facts, summaries, links, dates, values, and provenance;
- state such as loading, stale, partial, empty, or failed;
- units, periods, and comparison meaning for metrics and charts;
- priority such as featured, standard, or compact when editorial emphasis matters;
- permitted actions and their destinations;
- page size, current page or cursor, total count or continuation state for long feeds;
- one to four canonical topic strings per item when topics are available;
- exact bulk-action label, scope, consequences, confirmation copy, handler, and current state when a batch action exists;
- preference state, if already known;
- featured flags, if editorial featuring is intended;
- whether source diagnostics should be visible or only summarized as data quality;
- optional Kurami Note text or enough harmless context to write one.

This skill may decide:

- layout, spacing, hierarchy, and responsive order within the supplied structure;
- which approved component represents each content role;
- visual emphasis consistent with supplied priority;
- light/dark token application;
- interaction states and accessible labeling;
- whether to omit an optional Kurami Note.

This skill may not:

- fetch or refresh content;
- choose news sources;
- rank or summarize stories;
- infer, normalize, merge, translate, or rename topic labels;
- infer a user's like/dislike preference;
- change read/unread state;
- add schedules or cron jobs;
- invent values, links, statuses, or editorial priority;
- copy demo facts from reference templates.

## Suggested payload shape

The payload may be JSON, YAML, Markdown, or native project data. A structured form should express semantic roles rather than layout instructions.

```json
{
  "page": {
    "kind": "daily-briefing",
    "title": "Доброе утро, Alex.",
    "date": "2026-08-26",
    "locale": "ru"
  },
  "sections": [
    {
      "id": "news",
      "title": "Новости, которые стоят времени",
      "kind": "story-list",
      "state": "ready",
      "items": []
    }
  ]
}
```

The example demonstrates shape only. Do not reuse its copy, date, or section choices unless they are present in the actual payload.

## State vocabulary

Prefer explicit states:

- `ready`: complete and current;
- `loading`: still being obtained;
- `empty`: successfully obtained, no items;
- `stale`: available but older than the caller's freshness policy;
- `partial`: some sources or fields are unavailable;
- `error`: failed and not safely representable as current;
- `offline`: unavailable because connectivity is absent.

Preserve the caller's state. This skill can choose the matching visual pattern but cannot upgrade `partial` or `stale` to `ready`.

## Collections

Every array is variable-length unless the caller explicitly defines a fixed schema. Layouts must support zero, one, and many items. This especially applies to stories, events, sources, trailers, premieres, currently playing films, metrics, and recommendations.

## Digest feeds

Use semantic feed data without provider-specific layout fields. A caller may supply a frozen numbered page or a live cursor, but it owns all retrieval and mutation behavior.

```json
{
  "kind": "digest-feed",
  "title": "Prepared section title",
  "total": 126,
  "pageSize": 12,
  "page": 1,
  "sourceFacets": [{ "id": "source-a", "label": "Prepared source", "count": 126 }],
  "items": [
    {
      "id": "caller-owned-id",
      "sourceLabel": "Prepared source",
      "sourceDetail": "Prepared sub-source",
      "title": "Prepared title",
      "summary": "Prepared summary",
      "topics": ["Prepared canonical topic", "Another canonical topic"],
      "expandedDigest": {
        "importance": "Prepared explanation",
        "facts": ["Prepared fact"]
      },
      "publishedAt": "caller-owned timestamp",
      "externalUrl": "caller-owned destination",
      "reaction": null
    }
  ],
  "bulkAction": {
    "scopeLabel": "Prepared source or batch",
    "label": "Prepared action label",
    "description": "Prepared scope description",
    "consequence": "Prepared consequence or exclusion",
    "confirmation": "Prepared confirmation copy",
    "state": "idle"
  }
}
```

The example describes roles only. Do not copy its strings into a page. Do not rename a source, infer or normalize a topic, generate an extended digest, change a reaction, advance a cursor, or execute a bulk action.

Keep the visual primitive source-agnostic. Provider-specific fields may appear as values supplied by the caller, not as required keys, class names, component names, or embedded behavior.

## Topics

`topics` is an optional ordered array of one to four display-ready canonical strings. The caller owns extraction, taxonomy, synonym resolution, casing, language, and future preference profiling. The renderer preserves the values exactly and only chooses their visual treatment. A source label such as a provider or channel remains provenance unless the caller independently includes it in `topics`.

## Metrics and charts

Every metric or series should identify what it measures, its unit, and its period when those are not obvious. A value such as `18` or a section such as `Внимание за 7 дней` is incomplete without a useful meaning. The renderer may display supplied context but must not invent a definition.

## Reader flow and diagnostics

Source health, ingestion freshness, and channel preference tables are diagnostic content. Do not place the full management table in the primary briefing flow unless the payload explicitly requests it. When the page state is `partial` or `stale`, prefer a compact `Качество данных` disclosure with a details action.

## Preference controls

Like/dislike controls are display and interaction surfaces only. The caller must provide the action handler or endpoint, initial state, and persistence behavior. This skill may render accessible `👍` and `👎` buttons and selected state but must not claim to have trained or calibrated a preference model.

## Bulk actions

A Bulk Source Action is a representation of caller-owned behavior. Require the caller to define the exact affected batch, cutoff or boundaries when relevant, confirmation requirement, success state, and error recovery. The renderer may display `idle`, `confirming`, `loading`, `success`, or `error`; it must not implement source APIs or silently broaden the action's scope.

## Kurami Notes

When the caller supplies exact note text, preserve it unless it violates the 1–4 word or safety rule; in that case omit it or ask for revision. When the caller asks the renderer to write a note, it may create only a short presentational aside grounded in visible content. It must never add a new factual claim.

## Cron composition

A future Hermes cron job should:

1. load one or more data-producing skills;
2. prepare and verify the content payload;
3. load `kurami-ui-preview-language` for rendering;
4. give the renderer a destination and preserve-content instruction;
5. publish or host only through a separate authorized deployment step.

Example intent:

```text
Collect and verify today's briefing using the configured source skills.
Then use kurami-ui-preview-language to render the prepared payload without
changing facts or ordering. Save the responsive light/dark preview to the
configured project destination.
```
