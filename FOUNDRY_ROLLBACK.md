# FOUNDRY_ROLLBACK

**Modules:** `lib/foundry/execution.ts`, `lib/orchestration/saga.ts` · **Status:** VERIFIED

## Behavior

- **Automatic (on failure)** — the saga compensates completed steps in reverse order.
- **Explicit** — `requestRollback` → run enters `rolling_back` → `performRollback` runs
  each completed step's `compensate` in reverse.
- **Separate authorization** — rollback re-authorizes at the vault gate with its own
  `scope: "rollback"`; a forward grant never covers rollback.
- **Rejected-gate rollback** — a human-rejected gate fails the run and triggers rollback.
- **Evidence preserved** — rollback actions are recorded and linked into the signed
  evidence manifest.

## Reversibility honesty

Adapters declare their compensation truthfully:
- `AUTOMATIC_REVERSIBLE` — GitHub repo delete, Vercel deploy cancel/delete, Cloudflare DNS
  delete, Stripe archive.
- `IRREVERSIBLE` — email send, SMS send (no compensation; declared, not faked).

A pause for a human gate is explicitly NOT a failure and does **not** trigger compensation
(`SagaPauseSignal`). Destructive rollback stays behind policy + approval. Tested in
`tests/foundry.test.ts` (compensation) and the end-to-end proof (stage 10).
