# FOUNDRY_EMAIL_QA_IMPLEMENTATION_REPORT.md

## What was built

A free, local, provider-neutral email QA/debug harness under `lib/email-qa/`,
distinct from and independent of Foundry's own deployment-orchestration
`ResendEmailAdapter` (`lib/foundry/providers.ts`). It validates product-facing
customer emails (dyln, PrimeOpp, fylr, PantiCandy, vITAL Core) before they are
ever sent, entirely offline, with zero credentials required.

## Files added

| File | Purpose |
|---|---|
| `lib/email-qa/types.ts` | Provider-neutral zod contracts: `ProductEmailConfig`, `EmailTypeDefinition`, `SenderIdentity`, `ReleaseBlockingRules`, `EmailPayload`, plus plain TS types for `ValidationResult`/`EmailQaEvidencePackage`/`DeliveryCorrelation`. |
| `lib/email-qa/validate.ts` | The free local tester — pure functions, no network: sender/reply-to checks, unresolved-placeholder detection, required-link/asset checks, template-var checks, and the verdict engine (`PASS/FAIL/BLOCKED/PASS_WITH_WARNINGS`). |
| `lib/email-qa/adapters/types.ts` | `EmailQaOutboundAdapter` boundary interface. |
| `lib/email-qa/adapters/local-fixture.adapter.ts` | Default adapter — always simulated, no network, no credential. |
| `lib/email-qa/adapters/resend-boundary.adapter.ts` | Resend adapter boundary. Only performs a real send when **both** a code-level `allowLiveSend: true` opt-in **and** `FOUNDRY_EMAIL_QA_ALLOW_LIVE_RESEND=explicit-live-send` are set; otherwise fully simulated. |
| `lib/email-qa/inbox.ts` | Virtual QA inbox, built on the existing `retainArtifact`/`listArtifacts` content-addressed artifact store (`lib/foundry/artifacts.ts`) rather than a new backend. |
| `lib/email-qa/evidence.ts` | Assembles the standardized `EmailQaEvidencePackage` and retains it as a machine-readable artifact. |
| `lib/email-qa/fixtures/dyln.sample-config.ts` | Sample dyln product config, `sample: true`, uses the RFC 2606 reserved `dyln.example` domain. |
| `tests/email-qa.test.ts` | 11 tests covering every required scenario (see test report). |
| `scripts/email-qa-proof.ts` | Runnable end-to-end proof (`npm run proof:email-qa`), emits `proof/evidence/email-qa-proof.json`. |

`package.json` gained one script: `"proof:email-qa"`.

## Design decisions and why

- **No new shared schema.** The virtual inbox and evidence packages reuse
  `retainArtifact`/`listArtifacts` (content-addressed, redacted-before-hash,
  retention-classed) instead of adding new collections to the shared
  `FoundryStore` type in `lib/foundry/types.ts`/`store.ts`. This keeps the
  entire mission additive and contained to `lib/email-qa/`.
- **Two independent gates for any real Resend call**, mirroring but not
  reusing Foundry's own `FOUNDRY_ALLOW_MOCKS=explicit-test-mode` pattern (a
  deliberately different flag name, `FOUNDRY_EMAIL_QA_ALLOW_LIVE_RESEND`, so
  Foundry's own deploy-time mock override can never accidentally enable a
  real email QA send, and vice versa): a code-level `allowLiveSend: true`
  passed by the caller, and the env flag set to the exact string
  `"explicit-live-send"`. Default (neither set) is always simulated.
- **Criticality drives severity, not just messaging.** `ReleaseBlockingRules.missingAssetSeverity`
  is a config-level knob so a product can decide missing-asset checks are
  advisory (`warning` → `PASS_WITH_WARNINGS`) or a hard release blocker
  (`error` → `FAIL`/`BLOCKED`), per the mission's "missing asset warns or
  fails according to criticality" requirement.
- **BLOCKED vs FAIL** is decided per email type, not per product: an error on
  a `releaseBlocking: true` email type (e.g. `password_reset`) is `BLOCKED`;
  the same error on a non-blocking type (e.g. `marketing_promo`) is `FAIL`.
  This lets one product config express "this specific trigger must never ship
  broken" without over-blocking unrelated sends.
- **Redaction before storage.** Every inbox message body is passed through
  `redactString` (`lib/vault/redaction.ts`) before it is hashed or written to
  disk, so no secret material accidentally embedded in a template render can
  ever land in the virtual inbox or an evidence artifact.
- **dyln sample config uses a fixture domain**, never dyln's real domain —
  the dyln repository itself was not read or modified; this is a shape
  placeholder only, explicitly marked `sample: true`.

## What was intentionally NOT built

- No real Resend send, no DNS mutation, no touch of `dyln`, `fylr`,
  `PrimeOpp`, `PantiCandy`, `vITAL Core`, or any other repo outside
  `C:\Users\jp718\foundry`.
- No UI. The mission asked for a harness/tester, not a dashboard; a UI can be
  layered on `lib/email-qa/evidence.ts`'s output later if needed.
- No paid provider required at any point — `npm test`, `npm run typecheck`,
  `npm run build`, and `npm run proof:email-qa` all run with zero credentials.
