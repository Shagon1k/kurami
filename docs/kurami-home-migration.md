# KURAMI_HOME migration

Kurami's canonical control-plane root is:

```text
/home/shagon1k/_hermes/_kurami
```

The first migration phase is intentionally non-destructive. The physical
directory remains at the legacy path:

```text
/home/shagon1k/_hermes/_orchestrator
```

and `_kurami` is a filesystem alias to that same directory. No state, secret,
runtime, backup, or repository data is copied or split.

## Compatibility contract

- New entrypoints set and prefer `KURAMI_HOME`.
- TypeScript and Discord plugin code accepts `ORCHESTRATOR_HOME` as a fallback.
- Shell entrypoints export `ORCHESTRATOR_HOME=$KURAMI_HOME` for older child
  processes.
- Active systemd, Caddy, wrapper, skill, and documentation paths use
  `/home/shagon1k/_hermes/_kurami`.
- The legacy physical path must not be removed while the alias phase is active.

## Phase-one verification

After deployment, verify:

1. `_kurami` and `_orchestrator` resolve to the same package and state files.
2. Hermes gateway, Docker, and preview ingress are active.
3. Project pollers and system-health jobs complete successfully.
4. `/kurami settings`, health history, and owner controls can invoke their
   bounded subprocesses.
5. State backup, encrypted recovery bundle, and off-site checksum verification
   succeed through the new path.
6. The deterministic regression suite passes.

## Rollback

During phase one, rollback does not move data. Revert the deployment commit,
restore the previous wrappers and systemd unit, restart the affected services,
and keep both filesystem names in place until validation is complete.

The future physical cutover is a separate maintenance operation. Only after
all active references use `KURAMI_HOME` should the real directory become
`_kurami` and the compatibility alias be inverted to
`_orchestrator -> _kurami`.
