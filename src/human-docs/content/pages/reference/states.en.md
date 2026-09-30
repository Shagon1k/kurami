---
title: States
summary: Every state listed in Kurami's databases — built straight from the migrations, so it matches the code.
section: reference
group: reference
order: 20
---

Kurami keeps each process's state in a database field with a fixed list of values. SQLite checks that list on every write (`CHECK ... IN (...)`), so the tables below are the complete set of what can ever appear in the database. They are built from the migrations when the docs are built, so they cannot drift from the code.

What the main states mean and how a run moves between them is explained in [Run lifecycle](@run-lifecycle) and [Publication and recovery](@daily-publication). A few values exist in the schema but are not written by the code today — those pages point them out.

## Project Orchestrator

::generated{name="orchestrator-states"}

## Digest

::generated{name="digest-states"}
