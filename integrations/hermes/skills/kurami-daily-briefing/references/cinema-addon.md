# Cinema add-on operation

Use this reference only for a Saturday Daily run when `cinema.enabled` is
`true`. Cinema is an isolated weekly add-on: its failure never changes the
normal Daily workflow, Telegram acknowledgement, or the previous successful
`/cinema` snapshot.

The deterministic runtime owns collection windows, provider calls, source
validation, candidate scores, deduplication, facts, ordering after selection,
media safety, rendering, and atomic promotion. Kurami owns only the bounded
news selection, Russian editorial copy, and grounded notes described below.

Use the production Cinema CLI:

```text
CINEMA_CLI=/home/shagon1k/_hermes/_kurami/app/dist/briefing/cinema/cli.js
```

## Weekly sequence

1. Create a Cinema artifact directory inside the active Daily attempt's run
   directory. Do not create a second scheduled job or a second database.
2. Freeze the candidate set:

   ```text
   $BRIEFING_NODE $CINEMA_CLI collect --date YYYY-MM-DD --output <cinema-candidate.json>
   ```

   The command itself enforces the Saturday coverage windows. Never substitute
   an improvised provider, broaden the configured YouTube channels, or move an
   item across the fixed time window.
3. Read the bounded candidate JSON and write only
   `cinema-editorial-draft.json` with the Hermes `write_file` tool. Use this
   exact shape:

   ```json
   {
     "version": 1,
     "localDate": "YYYY-MM-DD",
     "news": [
       {
         "candidateId": "an exact candidate ID",
         "headline": "Новый самостоятельный заголовок на русском",
         "summary": "Краткий фактический пересказ новости на русском без воды и домыслов."
       }
     ],
     "notes": [
       {
         "id": "note:stable-id",
         "target": "news:an-exact-selected-candidate-id",
         "text": "короткая живая пометка",
         "mark": "arrow-down-left"
       }
     ]
   }
   ```

4. Select at most 15 news candidates. Prefer the highest deterministic scores,
   but use the permitted score band for editorial relevance and source
   diversity. Do not select more than roughly 40% from one publisher when
   qualified alternatives exist. A headline is a complete Russian phrase, not
   a clipped source title and not a stock prefix. A summary states the useful
   substance in one compact paragraph and may not invent facts absent from the
   candidate title, excerpt, categories, date, or publisher.
5. For ten or more selected stories, write two or three unique Kurami Notes;
   otherwise use zero to two when there is a genuinely grounded observation.
   Notes contain one to four words, balance information with gentle humor, and
   target a real visible section or `news:<candidateId>`. Do not use a static
   phrase pool, generic filler, or jokes about sensitive material.
6. Cache only approved still images:

   ```text
   $BRIEFING_NODE $CINEMA_CLI cache-media --candidate <cinema-candidate.json> --draft <cinema-editorial-draft.json> --output <cinema-media.json>
   ```

   Missing images are fail-soft. Never download video or let media failure
   remove an otherwise valid factual item.
7. Compose the immutable envelope:

   ```text
   $BRIEFING_NODE $CINEMA_CLI compose --candidate <cinema-candidate.json> --draft <cinema-editorial-draft.json> --media <cinema-media.json> --output <cinema-envelope.json>
   ```

   If the editorial news step alone cannot be completed, the bounded fallback
   is permitted:

   ```text
   $BRIEFING_NODE $CINEMA_CLI fallback --candidate <cinema-candidate.json> --media <cinema-media.json> --output <cinema-envelope.json>
   ```

   The fallback omits Cinema news rather than generating placeholder copy. It
   is promotable only when the runtime still finds at least two independent,
   trustworthy non-empty sections.
8. Prepare the deterministic page, then promote the exact prepared envelope:

   ```text
   $BRIEFING_NODE $CINEMA_CLI prepare --envelope <cinema-envelope.json>
   $BRIEFING_NODE $CINEMA_CLI promote --envelope <cinema-envelope.json>
   ```

   `prepare` cannot move `/cinema`. `promote` atomically finalizes the prepared
   `cinema:YYYY-MM-DD` edition and updates the current Cinema snapshot. A
   rejected promotion leaves the previous snapshot and route unchanged.
   `/cinema` is the only production Cinema route: do not publish or announce a
   dated Cinema URL. Dated `/preview/cinema/YYYY-MM-DD` routes are staging-only.
9. Continue the normal Daily composition. The Daily runtime attaches Cinema
   only when the promoted snapshot has this exact local date. The shared UI
   renderer then shows only the compact Saturday preview in Daily and the full
   deterministic edition at `/cinema`.

## Truthful partials

- No YouTube capability: omit trailers and report the section failure.
- No fresh premiere inside the next-week window: use `empty`, not older films.
- Box Office Watch failure: the runtime may use its bounded AP/Comscore Top 10
  fallback. Do not restore unavailable trend, YTD, or movement data by hand.
- Cinema collection, copy, image, render, or promotion failure: record the safe
  diagnostic and continue Daily without a Cinema preview for that date.
- Never reuse last week's snapshot inside a new Saturday Daily page. The old
  snapshot may remain current at `/cinema`, but its date must not match and the
  Daily composer will therefore omit it.
