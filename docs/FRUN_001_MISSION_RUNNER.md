# FRUN-001 Foundry Local Mission Runner and Model Continuity Router

Status: native implementation present and runtime-proven.

## Components

- `lib/mission-runner/index.ts` owns durable mission records, iteration records, repository binding, exclusive locks, process capture, continuation packets, takeover reconciliation, provider admission, failure classification, route decisions, human-gate classification, deterministic test selection, and Mission Control reporting.
- `app/api/mission-control/route.ts` exposes a compact authenticated operator view.
- `tests/mission-runner.test.ts` proves the core behavior with deterministic fixtures.
- `scripts/frun-runtime-proof.ts` creates a disposable Git repository and runs the end-to-end runtime proof.
- `proof/evidence/frun-001-runtime-proof.json` stores the current proof package.

## Architecture

Foundry owns mission state. Agent providers are replaceable workers behind `AgentAdapter`.

Initial adapters:

- Codex CLI: command contract and configuration validation.
- Claude Code: command contract and configuration validation.
- OpenRouter: boundary adapter with endpoint/model validation and no default production authority.
- Ollama: boundary adapter with endpoint/model validation and no default production authority.
- Deterministic fixture agent: non-provider runtime proof worker.

The mission runner refuses silent authority escalation: provider/model admission records define allowed actions, denied actions, retry/cost limits, verification requirement, security classification, and production authority.

## Runtime Proof

`npm.cmd run proof:frun-runtime` proves:

- mission creation;
- repository and branch binding;
- exclusive mutation lock;
- concurrent mutator rejection;
- two bounded worker slices;
- controlled fixture change;
- durable iteration ledger;
- continuation packet generation;
- simulated worker interruption;
- read-only takeover before reconciliation;
- write authority after reconciliation;
- no repeat of completed criterion;
- continuation of unfinished criterion;
- controller restart reload;
- usage-limit classification and single route decision;
- Mission Control report;
- canonical VERIDIAN/E.V.E. verification before mission completion.

The fixture repository lives under `.foundry-test-data/frun-runtime-proof/fixture-repo` and is disposable.

## E.V.E. Boundary

Foundry does not self-certify FRUN completion. The proof script invokes canonical VERIDIAN:

`C:\Users\jp718\Downloads\workspace-847129d7-6103-4bd5-bf51-eaa3c760dd0f\scripts\verify-frun-continuity-proof.ts`

That verifier checks repository binding, branch, reachable implementation commit, fixture repository identity, lock/takeover/continuation evidence, duplicate-work prevention, and final criteria state.

## Safety

- Repository roots are resolved through Git before mutation.
- Locks are durable records plus exclusive lock directories, not just PID files.
- Stale locks require stale heartbeat and dead process evidence.
- Takeover starts read-only and blocks write authority on wrong repo, wrong branch, wrong HEAD, unexplained dirty state, or missing test context.
- Process execution uses structured command/argument arrays and an environment allowlist.
- Process stdout/stderr are redacted through Foundry artifact retention and truncated in summaries.
- Human gates are limited to real human-required reasons; engineering failures and usage limits are not human gates.
