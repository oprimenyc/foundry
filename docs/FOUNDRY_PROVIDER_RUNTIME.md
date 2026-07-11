# FOUNDRY_PROVIDER_RUNTIME.md

**Foundry Universal Execution Runtime — M2 Architecture**
**Status:** Operational with mock providers (runtime-proven: `npm run proof:m2`)

---

## Execution model

```
                 Planner (LLM — categories only, never vendors)
                                 │
                                 ▼
                          Execution Plan
                (steps: provider:"auto" + category + action)
                                 │
                                 ▼
                    ┌── Provider Selection Engine ──┐
                    │  tenant policy → credentials  │
                    │  → health → cost → latency    │
                    └───────────────┬───────────────┘
                                    ▼
                        Capability Validation
              (action ∈ manifest.supportedCapabilities, fail closed)
                                    │
                                    ▼
                        Credential Resolution
                  (references only — secret:<id>/<purpose>;
                   plaintext never leaves the KMS-backed store)
                                    │
                                    ▼
                             Execution
            (saga orchestrator; retries; timeouts; generic
             reference propagation — no vendor branching)
                                    │
                                    ▼
                            Verification
              (launch evidence: capability-derived requirements,
               foundry-launch-verifier@2)
                                    │
                                    ▼
                              Rollback
              (compensation in reverse; truthful non-rollback for
               email/SMS; provider.rollback === compensate)
                                    │
                                    ▼
                              Evidence
              (durable events, evidence records, provider refs)
                                    │
                                    ▼
                               E.V.E.
              (independent verification — never trusts execution;
               verdict PASS/HOLD from verifyRunIndependently)
```

## Layer map

| Component | File |
|---|---|
| Provider Registry / Capability Registry | `lib/foundry/universal/registry.ts` |
| Provider Interface / manifests / tenant policy | `lib/foundry/universal/types.ts` |
| Provider Selection Engine | `lib/foundry/universal/selection.ts` |
| Provider Health Engine | `lib/foundry/universal/health.ts` |
| Provider Cost Engine | `lib/foundry/universal/cost.ts` |
| Provider Verification Engine | `lib/foundry/universal/verification.ts` |
| Provider Credential Registry | `lib/foundry/universal/credentials.ts` (+ KMS custody in `lib/foundry/credentials.ts`) |
| Provider catalog (the ONLY vendor-name site) | `lib/foundry/universal/catalog.ts` |
| Execution engine (vendor-free) | `lib/foundry/execution.ts` |
| Plan validation + auto-selection | `lib/foundry/plan.ts` |
| Independent run verification | `lib/foundry/verification.ts` |

## Invariants (test-enforced)

- Core execution modules contain no vendor-name branching (`tests/universal.test.ts`).
- Unknown provider / category / action → fail closed with typed errors.
- Mocks refuse production unless `FOUNDRY_ALLOW_MOCKS=explicit-test-mode`.
- Credentials appear only as references (env-var names, `secret:` handles) in plans, logs, and API output.
- Verification stays independent from execution (DL-006): E.V.E. records append-only verification attempts and can disagree with a run's own success claim.

## Runtime proof (2026-07-11)

`npm run proof:m2` — 34 providers / 20 categories; author-agnostic plan resolved
to local-git + railway + cloudflare + resend; 8/8 steps completed; launch
evidence passed; idempotent replay with strictly-ordered events; E.V.E. PASS;
rollback rolled back 5 steps. Suite: 54/54 tests pass; typecheck clean.
