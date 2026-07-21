# Foundry ↔ dyln ↔ VERIDIAN — Email Governance Bridge Proof

Cross-repo evidence binding for the dyln email QA governance bridge (mission Phase 2). Machine-readable bundle: `proof/evidence/dyln-email-governance-binding-proof.json` (run `npm run proof:dyln-governance-binding` to regenerate — reads Foundry's own evidence plus two VERIDIAN evidence files read-only, no code imported across repos).

## The three independent evidence sources

| # | Source | Repo | Axis | Verdict |
|---|---|---|---|---|
| 1 | `evidence/proofs/dyln-email-qa-admission/SUMMARY.json` | VERIDIAN | pre-execution admission — "is the declared email spec complete?" | **PASS** (0 blocking, 0 warning gaps across 17 declarations) |
| 2 | `proof/evidence/dyln-email-qa-integration-proof.json` | Foundry | local QA harness — "does the rendered output match the product's declared rules?" | **FAIL** (16 PASS, 1 FAIL: `follow-up-email` sender mismatch — a real, pre-existing, documented dyln gap) |
| 3 | `evidence/proofs/eve-dyln-email-evidence/SUMMARY.json` | VERIDIAN (E.V.E.) | independent verification — "does the captured evidence hold up on its own terms?" | **PASS** (17/17; hash re-derivation confirms no tampering) |

These three verdicts are **expected to diverge** — each checks a genuinely different thing, by design (see each repo's own "axis discipline" comments). `follow-up-email` failing axis 2 but passing axis 3 is not a bug: Foundry's harness checks *correctness against the product's declared sender rule* (which `follow-up-email` violates — it really does send from `noreply@getdyln.com` instead of `support@getdyln.com`); E.V.E. checks *completeness/consistency/safety of the captured evidence itself* (which holds up fine — the evidence is real, complete, unmodified, and safe, even though what it describes is a known product defect).

## Cross-repo consistency checks (all 7 pass)

1. All three evidence sources read successfully, read-only.
2. **dyln repo HEAD is identical across all three**: `9f03187b9ec5e5dbe9ba80c781a1b514db62c63b`.
3. All three verdicts are well-formed values from the shared `PASS`/`FAIL`/`BLOCKED`/`PASS_WITH_WARNINGS` vocabulary.
4. No real email sent — confirmed by all three sources independently.
5. dyln repo never mutated — confirmed by Foundry's own `dylnRepoWritten: false` and E.V.E.'s `dylnMutated: false`.
6. No VERIDIAN database write, no Foundry mutation attempted by the bridge itself.
7. Every one of the 17 email fixtures independently confirms a non-production recipient (`@dyln.test` only) and no provider call.

## Safety summary

```
dylnMutated: false
realEmailSent: false
resendCalled: false
productionRecipients: false
providerStateModified: false
```

## Genuine cross-repo tamper evidence (not a self-check)

Foundry computes `capturedSubjectHash` / `capturedRenderedBodyHash` over each email's captured subject/body **before** the evidence bundle ever leaves Foundry. VERIDIAN's E.V.E. bridge (`src/lib/eve/dyln-email-evidence-bridge.ts`) passes those pre-committed hashes through as `evidenceHashes` declarations; `verifyEmailEvidence` independently recomputes them from the content in the same submission and compares. A deliberately-tampered submission (body content altered after the hash was committed) is caught as `EVIDENCE_HASH_MISMATCH` — see `EVE_DYLN_EMAIL_VERIFICATION_PROOF.md` step 8.

## What independent verification actually caught, mid-mission

While building the E.V.E. bridge, all 17 fixtures initially failed E.V.E.'s reply-to check — a real, previously-invisible finding: Foundry's `mapDylnFixtureToPayload` only populated a captured reply-to value when dyln's fixture had `replyToExplicit: true`, which none of the 17 real Tier A fixtures do (they all rely on default-reply-to-equals-from transport behavior). E.V.E.'s stricter contract (reply-to evidence must always be present) correctly flagged this as missing. Resolution: Foundry's newly-added `capturedReplyToAddress` field now carries dyln's declared `replyToExpected` (the effective reply-to a recipient would observe) rather than only the conditional, often-undefined `payload.replyTo` Foundry's own (pre-existing) validator uses for its own narrower purpose. Foundry's own sender/reply-to validation logic was left untouched. This is exactly the value proposition of chaining independent verifiers — it is reported here rather than quietly worked around.
