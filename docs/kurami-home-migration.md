# KURAMI_HOME migration

Kurami's canonical control-plane root is:

```text
/home/shagon1k/_hermes/_kurami
```

The physical cutover is complete. `_kurami` is now the real directory that
owns the application, runtime, configuration, state, secrets, backups, logs,
and recovery data.

The legacy path is retained as a compatibility symlink:

```text
/home/shagon1k/_hermes/_orchestrator -> /home/shagon1k/_hermes/_kurami
```

The cutover was an atomic rename on the same filesystem. No state, secret,
runtime, backup, or repository data was copied or split.

## Compatibility contract

- New entrypoints set and prefer `KURAMI_HOME`.
- TypeScript and Discord plugin code accepts `ORCHESTRATOR_HOME` as a fallback.
- `src/core/kurami-home.ts` centralizes canonical precedence and emits at most
  one `KURAMI_LEGACY_HOME` warning per process when only the legacy variable is
  available. It never includes the resolved path in that warning.
- All TypeScript runtime modules use the shared resolver. Direct legacy fallback is
  centralized in `src/core/kurami-home.ts` while compatibility remains available.
- Shell entrypoints export `ORCHESTRATOR_HOME=$KURAMI_HOME` for older child
  processes.
- Active systemd, Caddy, wrapper, skill, and documentation paths use
  `/home/shagon1k/_hermes/_kurami`.
- `_kurami` must remain a real directory.
- `_orchestrator` must remain a symlink to `_kurami` until legacy fallback is
  deliberately retired.

## Post-cutover verification

After deployment, verify:

1. `_kurami` is a real directory and `_orchestrator` resolves to it.
2. Hermes gateway, Docker, and preview ingress are active.
3. Project pollers and system-health jobs complete successfully.
4. `/kurami settings`, health history, and owner controls can invoke their
   bounded subprocesses.
5. State backup and encrypted recovery bundle creation succeed through the new
   path; off-site verification remains part of the regular recovery workflow.
6. The deterministic regression suite passes.

## Rollback

Rollback remains bounded because the legacy alias is preserved:

1. Stop Hermes gateway, dashboard, and Kurami preview ingress.
2. Remove only the `_orchestrator` symlink.
3. Rename the real `_kurami` directory back to `_orchestrator` on the same
   filesystem.
4. Recreate `_kurami -> _orchestrator`.
5. Restart the services and repeat the verification checklist.

Do not copy the directory during rollback and do not remove either filesystem
name while compatibility code still accepts `ORCHESTRATOR_HOME`.

## Legacy retirement

The final cleanup is a later, separate change. Remove the `_orchestrator`
symlink and `ORCHESTRATOR_HOME` fallback only after runtime logs, cron jobs,
recovery tooling, project worktrees, and operator workflows no longer use the
legacy name.
