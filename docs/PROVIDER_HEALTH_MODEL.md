# PROVIDER_HEALTH_MODEL.md

**Foundry Provider Health Engine — M2**
**Source:** `lib/foundry/universal/health.ts`

---

## Signals

1. **Active probes** — `probeProvider(provider)` runs the provider's
   `healthCheck()` under a hard timeout (default 5s). A timed-out or throwing
   probe records as unhealthy — no silent failures.
2. **Passive outcomes** — callers record execution success/failure via
   `recordOutcome(providerId, ok)`.

## Scoring

Rolling success ratio over the most recent 20 outcomes, in `[0, 1]`.
No history → `1.0` (innocent until observed failing), so a fresh registry never
deadlocks selection.

## Use in selection

- Score `< 0.25` → ineligible **when an alternative exists**. If every
  candidate is below the floor, the degraded pool is still ranked and used —
  partial availability beats silent failure (Constitution Art. X).
- Above the floor, higher score outranks lower before cost and latency.

## Observability

- `healthSnapshot()` — all recorded scores + last probes.
- `GET /api/providers` exposes `healthScore` per manifest.
- Probes state their basis truthfully ("credential presence check; no network
  probe") — they never fabricate runtime claims.

Runtime-proven: `tests/universal.test.ts` — health scoring, health-driven
selection, and failover tests.
