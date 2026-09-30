---
title: How to read these docs
nav: How to read
summary: Depth layers, diagram notation and a few conventions about words, so every page reads the same way.
section: basics
group: guide
order: 10
next: glossary
---

Every section — Digest, Projects, Platform — is built the same way. **Start here** gives the whole picture in five minutes. **Guide** explains what you see and what to press. **How it works** shows the mechanism from inside. **Why it is so** collects the decisions that shaped it. **Reference** holds exact tables built straight from the code. Each page's header shows its layer and an approximate reading time.

## Diagram notation

Every diagram uses one set of shapes, and each shape has one meaning.

```diagram
kind: graph
title: Legend
desc: A process is a rectangle, a store is a cylinder, an external service has a dashed frame, you have a red frame. States are ovals: success is green with a double border, failure is red, waiting for you is amber dashed. A check is a hexagon, a database table is a card with fields, a note is handwritten text.
node owner "You" "your action" owner at 0,0
node process "Process" "part of Kurami" at 1,0
node store "Store" "database or files" store at 2,0
node external "External service" "GitHub, Discord" external at 0,1
node state "State" at 1,1
node done "Success" end at 2,1
node fail "Failure" fail at 0,2
node wait "Waiting for you" wait at 1,2
node check "Check?" decision at 2,2
node table "table" "field · field · field" entity at 0,3
node note "a handwritten note explains the node next to it" note at 1,3
edge owner -> process "ordinary step"
edge process -> store "asynchronous" dashed
edge state -> fail "failure path" accent
```

Arrows show the direction of action: who passes what to whom. A solid arrow is an ordinary step, a dashed one is asynchronous or optional, a red one is a failure or attention path. A dashed frame around a group of nodes is a boundary: a server, a product, a process. Grey full-width bands are the layers of the system.

Besides graphs there are two more kinds of diagram. A **sequence** has participant columns and message arrows going down in time. A **day** has hourly lanes showing what starts when.

## Conventions about words

- **You** are the owner of the system. Anything called "your decision" Kurami never does by itself.
- A **run** is one attempt at one issue from the board. An issue can have several runs.
- An **edition** is one Daily page for one day.
- The **exact commit** is the SHA of the PR's latest commit. Checks, reviews and previews belong to it, not to the PR in general.
- Names from the code — states, tables, files — are in `monospace` and match the code letter for letter.
- Times are local unless marked "UTC".
- A dash "—" means "unknown", not zero.

## Examples and code maps

An **Example** block follows one invented issue, edition or check through the page's whole mechanism. Its data is made up, but branch names, states and buttons are real. A **Guarantees** block lists what the system deliberately never does by itself. **Where it lives in the code** at the end of a page points to the files to start reading the source from.

:::cards
- [Glossary](@glossary) — every term in one place
- [Kurami in five minutes](@what-is-kurami) — if you are new here
:::
