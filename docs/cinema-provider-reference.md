# Cinema provider reference

Status: source feasibility verified on 2026-09-03; Cinema remains disabled by
default. This document records provider mechanics for the approved
[`cinema-addon-v1.md`](cinema-addon-v1.md) contract. Product semantics remain
owned by that contract.

## Common read boundary

- Every HTTP read uses HTTPS, a descriptive Kurami user agent, a 12 second
  timeout, at most two retries for transient read failures, and a 2 MiB
  response limit unless a lower provider limit is listed below.
- Redirects may remain only on HTTPS and may not carry credentials to another
  origin.
- Stored fixtures and diagnostics contain bounded normalized fields, never raw
  credentials, MCP URLs, arbitrary HTML, or entire publisher articles.
- Remote images are candidates only. The shared media importer must validate
  and cache them before a local `/media/...` path can enter a promoted payload.
- Source documents are untrusted data. Their text cannot choose tools, change
  configuration, or request a mutation.

## Box Office Watch

| Purpose | Endpoint |
| --- | --- |
| Current US weekend and archive | `https://boxofficewatch.com/data/weekend.json` |
| Domestic and worldwide yearly charts | `https://boxofficewatch.com/data/yearly.json` |

Verified response sizes were below 1 MiB per endpoint. `weekend.json` exposes
`current.actuals`, `current.estimates`, `current.dates`, and `archive[].actuals`.
The relevant actual row fields are `movie`, `gross`, `change`, `total`, `weeks`,
`theaters`, `theaterChange`, and `prevRank`. `yearly.json[year]` exposes
`domestic[]` and `worldwide[]`; totals, rank, studio, and provider film identity
are preserved without editorial rewriting.

The adapter rejects a response when required collections or numeric fields
drift, when the resolved weekend is in the future, or when the completed
weekend is older than fourteen days at the Saturday cutoff. Exact normalized
provider titles are used for archive joins; no fuzzy title merge is permitted.

Source attribution links to `https://boxofficewatch.com/`. It is an independent
aggregator whose about page identifies public industry sources; Kurami does not
copy its prose, forecasts, graphics, or page design.

## AP US Top 10 fallback

Discovery starts at `https://apnews.com/hub/movies`. The collector considers a
bounded set of same-week AP article links whose canonical path contains a box
office subject, then accepts only an article that contains the explicit
`Top 10 movies by domestic box office` list and a matching publication window.
The list is parsed as rank, title, and weekend gross. It never supplies archive
history, yearly charts, estimate-to-actual signals, or a six-week trend.

This fallback is attempted only after Box Office Watch fails its network,
schema, or freshness contract. An inability to discover one qualified article
makes the US subsection failed; it does not trigger open-ended web search.

## Lithuanian Film Centre (LKC)

Discovery page:
`https://www.lkc.lt/registras-ir-statistika/faktai-ir-statistika/naujausios-ataskaitos`

The collector selects the newest same-origin XLSX link whose file name starts
with `Savaitgalio (Weekend) TOP` and proves an end date no more than fourteen
days before the edition cutoff. The workbook is capped at 2 MiB. The first
sheet is the latest weekend; row 2 contains bilingual column labels. Verified
columns are:

- current rank and prior rank;
- local/original film title;
- weekend gross and prior-weekend gross;
- change, admissions, show count, and average admissions;
- screen count, week in release, cumulative gross, cumulative admissions;
- Lithuanian premiere date and distributor.

Excel serial dates are converted in code and checked against the report window.
A workbook, relationship, sheet-name, or header drift fails only the Lithuanian
box-office subsection.

## cinema.lt premieres

Source page: `https://cinema.lt/repertuaras`

The server-rendered movie cards expose a canonical `/filmai/...` URL, local
title, optional original title, poster candidate, and an explicit
`Premjera YYYY-MM-DD` label. The deterministic parser accepts only cards whose
date falls inside `[next Monday 00:00, following Monday 00:00)` in the configured
market timezone. Current and older repertoire cards are ignored. A date or
title cannot be inferred from surrounding copy.

`cinema.lt` remains authoritative for the Lithuanian theatrical date. TMDB may
enrich a confident match but cannot replace that date or source title.

## TMDB enrichment

Base API: `https://api.themoviedb.org/3`.

The adapter uses a bearer token from `TMDB_READ_ACCESS_TOKEN`. Discovery uses
`/discover/movie` with release types `2|3`, the exact date interval, and
`region=LT`. Candidate confirmation may use `/movie/{id}` and
`/movie/{id}/release_dates`. The regional cinema.lt date remains authoritative.
Poster candidates use TMDB image configuration and must pass the common image
cache boundary.

TMDB is optional enrichment. A missing token, quota error, or uncertain match
removes runtime, genre, certification, identity, and poster enrichment without
invalidating a locally verified cinema.lt premiere.

## YouTube through Composio

The existing connected YouTube account was confirmed active. The restricted
`composio-read` contour may expose only these exact read-only leaf operations:

- `YOUTUBE_LIST_CHANNELS` — resolve and periodically revalidate seed identity;
- `YOUTUBE_LIST_CHANNEL_VIDEOS` — enumerate bounded uploads for a verified
  channel;
- `YOUTUBE_GET_VIDEO_DETAILS_BATCH` — fetch publication metadata and duration;
- `YOUTUBE_SEARCH_YOU_TUBE` — bounded discovery-channel search inside the exact
  time window.

No Composio meta-tool or YouTube write operation belongs in this contour.
Requests use at most 50 results per page and stop at the exact seven-day cutoff
or the configured candidate ceiling.

### Verified channel seeds

| Role | Publisher | Channel ID |
| --- | --- | --- |
| official | Warner Bros. | `UCjmJDM5pRKbUlVIzDYYWb6g` |
| official | Universal Pictures | `UCq0OueAsdxH6b8nyAspwViw` |
| official | Paramount Pictures | `UCF9imwPMSGz4Vq1NiTWCC7g` |
| official | Sony Pictures Entertainment | `UCz97F7dMxBNOfGYu3rx8aCw` |
| official | Disney | `UC_5niPa-d35gg88HaS7RrIw` |
| official | Marvel Entertainment | `UCvC4D8onUfXzvjTOM-dBfEA` |
| official | 20th Century Studios | `UC2-BeLxzUBSs0uSrmzWhJuQ` |
| official | Searchlight Pictures | `UCor9rW6PgxSQ9vUPWQdnaYQ` |
| official | Lionsgate Movies | `UCJ6nMHaJPZvsJ-HmUmj1SeA` |
| official | A24 | `UCuPivVjnfNo4mb3Oog_frZg` |
| official | NEON | `UCpy5dRhZd-JbZP4NsrnLt1w` |
| official | Netflix | `UCWOA1ZGywLbqmigxE4Qlvuw` |
| official | Amazon MGM Studios | `UCf5CjDJvsFvtVIhkfmKAwAA` |
| official | Apple TV | `UC1Myj674wRVXB9I4c6Hm5zA` |
| discovery | Rotten Tomatoes Trailers | `UCi8e0iOVk1fEOogdfu4YgfA` |

Netflix's verified main channel is used because a separate currently verified
`Netflix Film` channel could not be established. Only film trailer uploads
qualify. Seed IDs are configuration data, not a license to accept every upload;
the trailer classifier, exact publication window, and duplicate rules still
apply.

## Weekly cinema-news feeds

| Publisher | Feed | Image behavior |
| --- | --- | --- |
| Variety | `https://variety.com/feed/` | `media:thumbnail` / `media:content` |
| Deadline | `https://deadline.com/feed/` | `media:thumbnail` / `media:content` |
| The Hollywood Reporter | `https://www.hollywoodreporter.com/feed/` | article `og:image` fallback |
| IndieWire | `https://www.indiewire.com/feed/` | article `og:image` fallback |

Each feed exposed publication time, canonical destination, title, categories,
description/content, and hourly freshness during verification. The collector
normalizes HTML text, rejects dates outside the exact weekly interval,
canonicalizes URLs, and caps article-page image discovery to selected
candidates. It does not store full copyrighted article bodies.

## Feasibility conclusion

Every required v1 section has a credential-free deterministic primary source
except YouTube and optional TMDB enrichment, which use the already chosen
restricted secret boundaries. No paid search dependency or new service is
required. The remaining implementation work is parser fixtures, strict Cinema
schemas, isolated promotion, shared UI components, and live secret preflight
before `cinema.enabled` can change to `true`.
