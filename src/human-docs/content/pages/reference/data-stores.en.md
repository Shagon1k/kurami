---
title: Data stores
summary: Every table of both Kurami databases — what one row holds, the key columns and the links. Built from the migrations.
section: reference
group: reference
order: 30
---

Kurami has two SQLite databases, each with its own migration history: `state/orchestrator.db` for Project Orchestrator and `state/briefing/briefing.db` for Digest. The tables below are built with the docs: the migrations are applied to an empty in-memory database and the resulting schema is read back. Each table's description lives next to the generator, and the build fails if a migration adds a table without one.

Where these databases live on disk and which other files hold state is explained in [Where state lives](@state-and-truth). The `created_at` and `updated_at` columns are left out; almost every table has them.

## orchestrator.db — Project Orchestrator

::generated{name="orchestrator-tables"}

## briefing.db — Digest

::generated{name="digest-tables"}
