---
title: For me
nav: For me
summary: How your 🔔 and 🔕 reactions reorder the news in an edition: when it starts working, what changes and which stories stay in place.
section: digest
group: guide
order: 30
next: signals
---

The news in an edition has two orders. **Обзор** (overview) is the order in which Kurami saved the edition in the morning. **Для меня** (for me) is the same stories rearranged by your reactions. No story is hidden or changed; only their places move. Overview is always available: press it and the morning order returns.

## Teaching the feed

1. Under any story press **🔔 Больше такого** (more like this) or **🔕 Меньше такого** (less like this). A second click on a pressed button clears the reaction.
2. Collect 10 reactions on different stories. Until then "Для меня" shows a message like "Пока обычный обзор: 4 из 10 реакций для персонализации" (plain overview for now: 4 of 10 reactions) and leaves the order alone.
3. Press **Для меня**. The page loads the order from the server and rearranges the stories. The address gets `?newsOrder=for-you`, so a reload keeps the mode.
4. A new reaction does not rebuild the feed by itself, so a story does not run away from under your hand. A line under the panel says "Реакция сохранена. Нажмите «Для меня», чтобы обновить порядок" (reaction saved; press "For me" to update the order).

## What counts as a signal

| Action | Counted |
|---|---|
| 🔔 or 🔕 on a story | yes; only the latest reaction per story counts |
| A repeated reaction on the same story | no, the weight does not double |
| Clearing a reaction | yes, the reaction leaves the count |
| Reading, expanding, opening the source | no |
| Reactions on stories from past editions | yes, reactions outlive the editions |

Kurami keeps only the story's topics and channel keys with a reaction. Headlines and texts never enter the profile.

## What changes and what stays

The order changes moderately. A story you are likelier to like rises a few places, not to the top. A topic starts to matter only after reactions on at least three different stories: two reactions on a topic mean nothing yet. Narrow topics and their combinations weigh more than the source.

Two kinds of stories stay exactly where they were:

- stories with importance "critical";
- stories urgent for today with high importance or high public interest.

All other stories fill the free places in the new order. The full mechanics and numbers are in [Choosing and ordering news](@news-selection).

## When something is off

| Situation | What you see | What to do |
|---|---|---|
| Fewer than 10 reactions | The "Пока обычный обзор…" message | Keep reacting |
| The server did not return an order | "Не удалось обновить профиль. Текущий порядок сохранён; можно повторить." (could not update the profile; the current order is kept) | Press **Для меня** again |
| A reaction was not saved | "Не удалось сохранить реакцию. Попробуйте ещё раз." (could not save the reaction; try again) | Click again |
| You want the morning order back | — | Press **Обзор** |

The explanation inside the page opens from the "Как учитываются интересы" (how interests are counted) link: it shows the strongest weights and for how many reactions the source is known.

:::cards
- [Choosing and ordering news](@news-selection) — the profile formula, limits and protected places
- [The morning edition](@daily) — the whole edition page
:::
