# KURAMI_HOME cutover

The canonical control-plane root for Kurami is:

```text
/home/shagon1k/_hermes/_kurami
```

`_kurami` is the real directory that owns the application, runtime,
configuration, state, secrets, backups, logs, and recovery data. The original
physical cutover was an atomic rename on the same filesystem; no data was
copied or split.

## Canonical contract

- Runtime entrypoints use `KURAMI_HOME` exclusively.
- `src/core/kurami-home.ts` resolves `KURAMI_HOME` or its location-derived
  default; it has no legacy environment fallback.
- TypeScript CLIs live in their canonical `src/system`, `src/orchestrator`,
  `src/discord`, and `src/core` modules. Flat `src/*.ts` compatibility
  entrypoints have been retired.
- Active systemd, Caddy, shell, plugin, skill, cron, and documentation paths use
  `/home/shagon1k/_hermes/_kurami`.
- `_kurami` must remain a real directory.
- The retired `_orchestrator` filesystem alias must not be recreated during
  normal operation.

## Verification

After deployment, verify:

1. `_kurami` is a real directory and the retired alias is absent.
2. Hermes gateway, dashboard, CPU sampler, and preview ingress are active.
3. Project pollers and system-health jobs complete successfully.
4. `/kurami settings`, health history, and owner controls invoke their bounded
   canonical subprocesses.
5. State backup and encrypted recovery bundle creation succeed through the
   canonical path; off-site verification remains part of the regular recovery
   workflow.
6. The deterministic regression suite passes.
7. Runtime source, tests, and deployed scripts contain no retired home
   environment reference or flat compatibility entrypoint consumer.

## Rollback

The physical `_kurami` directory remains authoritative. Do not rename or copy
it during a code rollback. If an undiscovered external consumer requires the
retired interface:

1. Revert the compatibility-retirement commit.
2. Recreate only the temporary filesystem alias to `_kurami`.
3. Restart the affected services and repeat the verification checklist.
4. Record the consumer and migrate it before attempting retirement again.

## Retirement record

The compatibility layer was retired on 2026-08-28 after a full TailorTales
dummy lifecycle, targeted migration tests, the complete regression suite, and
live cron/service checks. This removed the legacy environment fallback, child
environment exports, flat TypeScript entrypoints, legacy-named maintenance
wrappers, and the filesystem alias.
