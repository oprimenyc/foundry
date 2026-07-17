# FOUNDRY_RESTART_RECONCILIATION

**Modules:** `lib/foundry/execution.ts`, `instrumentation.ts`, `lib/foundry/store.ts` · **Status:** VERIFIED

## Behavior

- **Boot resume** — `instrumentation.ts` runs on Next.js boot and calls
  `resumeIncompleteRuns`, which restarts runs left `queued/running/rolling_back`.
- **No auto-resume of paused runs** — `awaiting_approval` runs stay paused across restart
  until a human decides (gates are durable, not in-memory).
- **Idempotent resume** — `executeRun` skips already-completed steps and reconstructs event
  sequence + provider references from the durable snapshot, so no provider mutation is
  duplicated.
- **Double-execution guard** — an in-process `__foundryActiveRuns` set prevents concurrent
  re-entry.
- **Durable, crash-safe store** — atomic file (temp+rename) in dev, `node:sqlite`
  WAL+FULL transactional single-row in production; a production run fails closed on
  non-production-safe persistence.

## Proven interruption points

Provider request, approval gate (pause survives restart), deployment polling, artifact
write, runtime verification, and rollback. The end-to-end proof (stage 11) resets the
persistence handle to simulate a restart and confirms the terminal state is preserved with
no double-mutation. Also tested in `tests/foundry.test.ts` ("restart resumes safely").

## Note

Simulating a restart in a single process requires draining in-flight background writers
first (a real restart is a fresh process); the proof harness does this before swapping the
persistence handle to avoid a dual-writer file race.
