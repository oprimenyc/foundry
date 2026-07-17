# Foundry Live Runtime

**Status:** VERIFIED — Foundry runs as an independent local HTTP service.

## Launch (one documented command)

```
powershell -File scripts\start-foundry-local.ps1 -Port 4319
```

Resolves the repo root, generates a local-dev RSA keypair under `.secrets/` if absent (never printing secrets), sets file persistence + RSA-PSS signing env, refuses a duplicate server on the port, starts `node node_modules/next/dist/bin/next dev -p <port>`, writes a PID file to `.secrets/foundry.pid`, and waits for `/api/healthz` readiness before returning (nonzero on failure).

Stop: `powershell -File scripts\stop-foundry-local.ps1`. Health: `powershell -File scripts\test-foundry-health.ps1 -Port <port>`.

## Health (truthful)

`GET /api/healthz` performs a real persistence read/write probe (`persistenceHealth()`), and reports planner/auth/persistence/mock-provider mode. It does not report healthy merely because the process started — an unwritable store surfaces as unhealthy.

## Persistence (restart-safe)

Single-document store; `file` backend (`.foundry-data/store.json`, atomic temp+rename) in dev, `sqlite` (WAL + transactional) in production. On boot, `instrumentation.ts` → `resumeIncompleteRuns()` resumes incomplete runs. Repeated starts preserve data; the launcher never deletes the store.

## Observed

- `GET /api/healthz` → `{status:"ok", persistence:"file", production_safe_persistence:true, auth:"open-dev", mock_providers:"dev"}` at `http://127.0.0.1:4319`.
- Boot log: `[foundry] startup recovery: incomplete runs resumed`.
- Real mission executed end-to-end (see `FOUNDRY_MISSION_EXECUTION.md` / `FOUNDRY_RUNTIME_PROOF.md`).
