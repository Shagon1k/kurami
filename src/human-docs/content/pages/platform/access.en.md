---
title: External access
nav: Access
summary: How Kurami's sites become reachable to you from outside and to nobody else: the tunnel, Cloudflare Access, local ports, previews through Caddy and what is configured outside the repository.
section: platform
group: guide
order: 80
next: docs-process
---

Cloudflare Access checks your identity before the tunnel delivers a request to a local port. Every service listens on `127.0.0.1`. Native Digest and Docs rely on the edge policy; Hub controls validate the signed token, origin and CSRF token. Projects supports signed owner validation through its Access configuration. The unified gateway adds assertion checks before forwarding requests to any app. An anonymous public visitor reaches Access login instead of private content.

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
| Docs at the unified entry | `127.0.0.1:8799` | Cloudflare Access through the gateway |
| Hub | `127.0.0.1:8800` | Cloudflare Access; its Controls also check the signed Access token, the origin and a CSRF token |
| Projects | `127.0.0.1:8777` | Cloudflare Access; configured owner assertion checks and origin checks on controls |
| Project previews, `preview-N.shagon1k.win` (N from 1 to 6) | through Caddy, `127.0.0.1:9180` | Cloudflare Access plus a 404 for any address without a running preview |
| The "Open in Codex" link | through Caddy | no Access: a redirect by exact task identifier |

## Unified app entry

The unified gateway on port `8888` routes Hub, Digest, Projects and Docs without
combining their services. This entry is deployed; `/en/`
opens Hub; `/en/digest/`, `/en/projects/` and `/en/docs/` open the other apps.
Russian routes start with `/ru/`; `/` redirects to English. The **Apps** menu
stays inside this entry. Hermes, Dokploy, previews and the Codex redirect remain
separate resources.

The owner removed the four separate app hostnames. The loopback origins remain
required by the gateway; they are not public replacement entrances.

The gateway checks signed Access assertions before forwarding a private request.
Your owner-only Access policy determines who can enter. The gateway checks the
issuer, application audience, signature and expiry and requires a human app
identity. An optional email allowlist adds a local restriction; service tokens
do not grant owner access.
Missing configuration, an invalid assertion or a foreign origin on a write
request is denied. Hub and Projects retain their own control checks. A separately
configured Docs reader identity can read only Docs, not dashboards or controls.
The existing hostnames remain available until you approve their redirect cutover.

Fetching Cloudflare's public signing keys has a 15-second deadline.
A timeout, network error or malformed key response returns `503` with a temporary
sign-in verification message. Refresh the page in a few seconds.
Invalid or missing assertions still receive `403`; private data and actions remain
unavailable without a verified signature.

One Kurami PWA covers all four apps. Its fox icons are exported directly from
vector paths at 512 and 1024 pixels, without enlarging a raster source. The icons and splash
follow the theme chosen in Hub: in Paper the fox sits on warm beige, in Neon it is
drawn as neon tubes on the dark ground. The adaptive icon keeps the mark within
Android's safe area; the launcher owns its final shape. The app opens in the
language of the last page you opened (the `kurami-lang` cookie), and before that
in the browser's language.
New icon URLs do not force an installed Android app to update immediately;
Chrome may ask you to confirm the changed icon in the app menu.
The worker fetches pages from
the network and shows a connection placeholder offline. It does not save private
pages or API responses. The one exception is "Read offline" in Daily's news: after
you agree on this device it keeps one page with the stories only, no mail, schedule
or images; turning it off deletes it. Deployment and installed-phone checks are separate from
the local routing tests.

Browser tabs and the installed PWA use the same edge-to-edge page shell and safe
screen insets. Whether the system gesture strip becomes transparent depends on
the browser and OS, especially for an installed Android PWA; the page cannot force
it. Kurami remains in standalone mode, not fullscreen. Verify both a browser tab
and the installed app on your phone after deployment; desktop emulation checks
layout, not the native system bars.

Install from the unified entry after signing in. The Apps menu keeps Hub, Digest,
Projects and Docs in that window, including when you enter through an older address.
All four apps reuse the same font URLs. Your browser can cache these design files;
private pages and API responses still come from the network.

## Previews through Caddy

Previews get an address like `preview-N.shagon1k.win` by slot number. Caddy is a separate service, `kurami-preview-ingress`: it listens on `127.0.0.1:9180`, and Project Orchestrator builds the route list into the file `state/caddy/routes.caddy` from the lease database. Only a preview in the "running" state has a route; for any other address Caddy answers 404 "no active route". Before applying a new configuration Caddy validates it, and on failure it restores the previous one. More about slots and leases is in [Previews](@previews).

## The link to the Codex app

Discord accepts only HTTP(S) in link buttons, while Codex opens by a `codex://` address. So the button leads to a narrow redirector in the same Caddy: it accepts only a path with an exact task UUID and answers with a redirect to `codex://threads/<uuid>`. This route is deliberately not behind Access: it carries no data, and the Codex app checks your session itself.

## What is not in the repository

The Cloudflare settings — tunnel routes for `preview-1…6`, Access policies, a service token for automated checks of the documentation — live in the Cloudflare dashboard. The repository neither checks nor changes them; to restore the server they must be created by hand ([Recovery](@recovery)). That an anonymous request to an address gets a redirect to the login can be observed, but the rules of "whom to let in" are not visible from the repository. For Hub this dependency is the most important one: without Access the read-only areas are open to anyone who reaches the port. The controls fail closed: with no valid Access token for the configured team and application they refuse to run.

:::code-map
- `deploy/systemd/kurami-preview-ingress.service` — the Caddy service
- `deploy/config/Caddyfile` — Caddy settings: local address, route import
- `src/orchestrator/projects/previews/ingress.ts` — building routes from leases
- `src/human-docs/server.ts` — the documentation server, GET and HEAD only
- `src/hub/server.ts` — the Hub server on `127.0.0.1`
- `src/hub/access.ts` — the Access token check used by the Hub controls
:::
