---
title: External access
nav: Access
summary: How Kurami's sites become reachable to you from outside and to nobody else: the tunnel, Cloudflare Access, local ports, previews through Caddy and what is configured outside the repository.
section: platform
group: guide
order: 80
next: docs-process
---

There is one way to Kurami's sites: Cloudflare Tunnel delivers a request to the server, Cloudflare Access first checks that it is you, and only then does the request reach a local port. The services themselves check nothing — they listen on `127.0.0.1` and assume that an already verified request has reached them. An anonymous visitor is redirected to the Access login and does not reach the service.

```diagram
kind: graph
title: The path of a request from outside
desc: A request goes through Cloudflare Access and the tunnel to the server's local ports. The Digest, documentation and Hub sites listen directly. Previews go through Caddy, which opens a route only for a running preview.
node you "You" "browser" owner at 0,0
node access "Cloudflare Access" "identity check" external at 1,0
node tunnel "Cloudflare Tunnel" "route to the server" external at 2,0
node digest "Digest" "127.0.0.1:8787" at 0,2
node docs "Documentation" "127.0.0.1:8799" at 1,2
node hub "Hub" "127.0.0.1:8800" at 2,2
node caddy "Caddy" "127.0.0.1:9180" at 1,3
node preview "Preview" "a port per run" at 1,4
group vps "Server" digest docs hub caddy preview
edge you -> access "HTTPS"
edge access -> tunnel "allowed"
edge tunnel -> digest
edge tunnel -> docs
edge tunnel -> hub
edge tunnel -> caddy
edge caddy -> preview "running only"
```

## What is reachable where

| What | Port on the server | Protection |
|---|---|---|
| Digest | `127.0.0.1:8787` | Cloudflare Access |
| This documentation, `docs.shagon1k.win` | `127.0.0.1:8799` | Cloudflare Access; `/` redirects to `/en/` |
| Hub | `127.0.0.1:8800` | Cloudflare Access |
| Project previews, `preview-N.shagon1k.win` (N from 1 to 6) | through Caddy, `127.0.0.1:9180` | Cloudflare Access plus a 404 for any address without a running preview |
| The "Open in Codex" link | through Caddy | no Access: a redirect by exact task identifier |

## Previews through Caddy

Previews get an address like `preview-N.shagon1k.win` by slot number. Caddy is a separate service, `kurami-preview-ingress`: it listens on `127.0.0.1:9180`, and Project Orchestrator builds the route list into the file `state/caddy/routes.caddy` from the lease database. Only a preview in the "running" state has a route; for any other address Caddy answers 404 "no active route". Before applying a new configuration Caddy validates it, and on failure it restores the previous one. More about slots and leases is in [Previews](@previews).

## The link to the Codex app

Discord accepts only HTTP(S) in link buttons, while Codex opens by a `codex://` address. So the button leads to a narrow redirector in the same Caddy: it accepts only a path with an exact task UUID and answers with a redirect to `codex://threads/<uuid>`. This route is deliberately not behind Access: it carries no data, and the Codex app checks your session itself.

## What is not in the repository

The Cloudflare settings — tunnel routes for `preview-1…6`, Access policies, a service token for automated checks of the documentation — live in the Cloudflare dashboard. The repository neither checks nor changes them; to restore the server they must be created by hand ([Recovery](@recovery)). That an anonymous request to an address gets a redirect to the login can be observed, but the rules of "whom to let in" are not visible from the repository. For Hub this dependency is the most important one: without Access the page is open to anyone who reaches the port.

:::code-map
- `deploy/systemd/kurami-preview-ingress.service` — the Caddy service
- `deploy/config/Caddyfile` — Caddy settings: local address, route import
- `src/orchestrator/projects/previews/ingress.ts` — building routes from leases
- `src/human-docs/server.ts` — the documentation server, GET and HEAD only
- `src/hub/server.ts` — the Hub server on `127.0.0.1`
:::
