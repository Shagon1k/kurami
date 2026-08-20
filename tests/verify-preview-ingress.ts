import { renderRoutes, type IngressRoute } from "../src/preview-ingress.ts";
import { codexLaunchUrl } from "../src/codex-deeplink.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function count(content: string, fragment: string): number {
  return content.split(fragment).length - 1;
}

function main(): void {
  const routes: IngressRoute[] = [
    {
      run_id: "r_preview_two",
      slot_number: 2,
      hostname: "preview-2.shagon1k.win",
      assets_hostname: "assets-preview-2.shagon1k.win",
      frontend_port: 43102,
      backend_port: 43202,
      minio_api_port: 49102,
      runtime_adapter: "compose",
      artifact_root: null,
    },
    {
      run_id: "r_preview_one",
      slot_number: 1,
      hostname: "preview-1.shagon1k.win",
      assets_hostname: "assets-preview-1.shagon1k.win",
      frontend_port: 43101,
      backend_port: 43201,
      minio_api_port: 49101,
      runtime_adapter: "compose",
      artifact_root: null,
    },
  ];

  const rendered = renderRoutes(routes);
  assert(rendered.includes(":9180 {"), "Ingress listener is absent");
  assert(rendered.includes("bind 127.0.0.1"), "Ingress is not loopback-bound");
  assert(
    rendered.indexOf("# r_preview_one") < rendered.indexOf("# r_preview_two"),
    "Routes are not deterministically ordered by slot",
  );
  assert(
    rendered.includes("path /api /api/*") &&
      count(rendered, "uri strip_prefix /api") === 2,
    "API prefix routing is incomplete",
  );
  for (const port of [43101, 43201, 49101, 43102, 43202, 49102]) {
    assert(rendered.includes(`127.0.0.1:${port}`), `Missing upstream port: ${port}`);
  }
  assert(count(rendered, "no active route") === 1, "Fallback route is not unique");
  const threadId = "01a00b9d-e72b-73f3-af6e-30760c2191c4";
  assert(
    codexLaunchUrl(threadId) ===
      `https://go.shagon1k.win/codex/threads/${threadId}`,
    "Codex HTTPS launcher URL is incorrect",
  );
  assert(codexLaunchUrl("not-a-thread") === null, "Unsafe thread ID was accepted");
  assert(
    rendered.includes("redir codex://threads/{re.codex_thread.1} 302"),
    "Codex desktop redirect is absent",
  );
  assert(
    rendered.indexOf("@codex_deeplink") < rendered.indexOf("# r_preview_one"),
    "Codex launcher is shadowed by preview routes",
  );

  const empty = renderRoutes([]);
  assert(empty.includes("no active route"), "Empty ingress is not fail-closed");
  assert(!empty.includes("reverse_proxy"), "Empty ingress contains an upstream");
  assert(
    empty.includes("@codex_deeplink"),
    "Codex launcher disappeared when no preview is active",
  );

  let rejected = false;
  try {
    renderRoutes([
      {
        ...routes[0],
        hostname: "preview-2.shagon1k.win { respond hacked }",
      },
    ]);
  } catch {
    rejected = true;
  }
  assert(rejected, "Unsafe hostname was accepted");

  const staticRendered = renderRoutes([
    {
      ...routes[0],
      runtime_adapter: "static",
      artifact_root: "/srv/kurami/state/previews/r_preview_two/artifact",
    },
  ]);
  assert(
    staticRendered.includes("static artifact") &&
      staticRendered.includes('root * "/srv/kurami/state/previews/r_preview_two/artifact"') &&
      staticRendered.includes("file_server") &&
      staticRendered.includes('Cache-Control "no-store"'),
    "Static artifact route is incomplete",
  );
  assert(
    !staticRendered.includes("reverse_proxy"),
    "Static artifact unexpectedly uses a Compose upstream",
  );

  let unsafeRootRejected = false;
  try {
    renderRoutes([
      {
        ...routes[0],
        runtime_adapter: "static",
        artifact_root: "../../etc",
      },
    ]);
  } catch {
    unsafeRootRejected = true;
  }
  assert(unsafeRootRejected, "Unsafe static artifact root was accepted");

  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      routes: routes.length,
      deterministicOrder: true,
      apiPrefixStripped: true,
      loopbackOnly: true,
      emptyFailClosed: true,
      unsafeHostnameRejected: true,
      staticArtifact: true,
      unsafeStaticRootRejected: true,
      codexDeeplinkRedirect: true,
    })}\n`,
  );
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
  process.exitCode = 1;
}
