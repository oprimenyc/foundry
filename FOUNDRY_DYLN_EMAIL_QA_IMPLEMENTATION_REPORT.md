# FOUNDRY_DYLN_EMAIL_QA_IMPLEMENTATION_REPORT.md

What was built and why, wiring dyln's completed email QA fixtures into Foundry's free/local email QA harness.

## Summary

Foundry now loads dyln's 17 real Tier A email fixtures read-only from `C:\REPLIT PROJECTS\dyln\dyln\server\services\__fixtures__\email\*.json`, runs them through the existing local/free email QA harness (`lib/email-qa/`), stores a virtual-inbox record for each, and emits a signed-style evidence bundle carrying dyln's repo path/HEAD and per-fixture hashes/verdicts. No dyln file was read at build time, only at runtime via `fs.readFileSync`/`readdirSync`; no dyln file was ever written; no Resend/SMTP call was made.

## Files changed (all inside `C:\Users\jp718\foundry`)

### New
| File | Purpose |
|---|---|
| `lib/email-qa/fixtures/dyln.config.ts` | Confirmed dyln `ProductEmailConfig` (`sample: false`), derived from dyln's audited inventory, not inferred. Replaces `dyln.sample-config.ts`. |
| `lib/email-qa/fixtures/dyln-loader.ts` | `DylnEmailFixture` type, independent shape validation, `loadDylnEmailFixtures()`, `mapDylnFixtureToPayload()`, `getDylnRepoState()` (read-only git handshake), `runDylnEmailQaIntegration()`. |
| `scripts/dyln-email-qa-proof.ts` | End-to-end proof script — `npm run proof:email-qa-dyln`. |
| `tests/email-qa-dyln.test.ts` | 7 tests covering the mission's required scenarios. |
| `FOUNDRY_DYLN_EMAIL_QA_CURRENT_TRUTH.md` | GATE 0/1 checkpoint and mapping-decision record. |

### Modified
| File | Change |
|---|---|
| `lib/email-qa/types.ts` | Added `checks.productIdentity` to `ValidationResult` (additive, non-breaking). |
| `lib/email-qa/validate.ts` | Added `validateProductIdentity()` — generic, product-neutral check that `payload.productId === config.productId`. Wired into `runEmailQaValidation`'s issue/check aggregation. |
| `tests/email-qa.test.ts` | Import/assertion updated for the renamed confirmed config (`sample: false`); added one regression test for the new product-identity check. |
| `scripts/email-qa-proof.ts` | Import updated; `dylnWelcomePayload()` now reflects the confirmed sender/domain/links; the "broken email" demo step now uses `payment-confirmed` (a real dyln type) instead of `password_reset` (which was only ever a placeholder in the old sample config and isn't one of dyln's 17 real Tier A fixtures). |
| `package.json` | Added `proof:email-qa-dyln` script. |

### Deleted
- `lib/email-qa/fixtures/dyln.sample-config.ts` — superseded by `dyln.config.ts`.

## Design decisions (why, not just what)

See `FOUNDRY_DYLN_EMAIL_QA_CURRENT_TRUTH.md` for the full record. Summary:

1. **Foundry never imports dyln source code.** Only the static `*.json` fixture files are read (dyln handoff's endorsed option "(b)"). This means a Foundry PASS proves the fixture's *declared contract* is well-formed and conforms to Foundry's generic email-QA contract — not that dyln's real, live-rendered HTML is bug-free (that remains dyln's own `emailFixtures.test.ts`'s job). Stated explicitly everywhere so it's never conflated.
2. **Single canonical sender.** dyln's real Tier A emails use two different from-addresses (`support@getdyln.com` for 16, `noreply@getdyln.com` for `follow-up-email`) — an inconsistency dyln's own inventory flags and explicitly asks integrators not to paper over. Foundry's config supports one canonical sender; `follow-up-email` correctly and expectedly produces a `SENDER_MISMATCH` **FAIL**. This is the harness doing its job, not a bug — verified by a dedicated test and by the integration proof's verdict breakdown (`16 PASS, 1 FAIL`, zero `BLOCKED`).
3. **No product-wide footer link.** 13 of 17 dyln emails carry the `emailShell()` unsubscribe/copyright footer; 4 hand-rolled templates don't. Rather than changing the shared, product-neutral contract to add a per-email-type footer override, the real unsubscribe link is asserted per-payload (`requiredLinks`) only when a fixture's own `legalFooter.unsubscribe` is `true` — an existing extension point, not a new one.
4. **No reply-to enforced** — matches dyln's own `replyToExplicit: false` on every fixture.
5. **Criticality vocabulary translated, not conflated.** dyln's `release-critical`/`revenue-critical` → Foundry's `release-blocking` (+`releaseBlocking: true`); `high`→`high`; `medium`→`standard`; `low`→`low`. Documented in `DYLN_CRITICALITY_MAP` in `dyln.config.ts`.
6. **Product-identity check added to the shared validator**, not bolted onto the dyln integration layer — it's a generic gap (a payload could previously validate silently against the wrong product's config) that benefits every product on the harness, and the mission's Task 2 explicitly asks for it.
7. **Synthesized payload bodies, not dyln's real render.** Template variables not literally present in a fixture's `args` are filled with a clearly-synthetic `qa-synth-<var>` value — never a guess at dyln's actual interpolation logic (which lives in `emailService.ts` and is out of Foundry's dependency boundary).

## Known, pre-existing observations (not fixed, out of this mission's scope)

- `lib/email-qa/validate.ts` declares `ProductEmailConfig.requiredLegalText` in the schema but never enforces it — a pre-existing dead field from the prior session's build, unrelated to this mission. Left as-is (no unrequested refactor of tested code).
- dyln's own inventory gaps (#3 from-address inconsistency, `paymentNotificationService.ts`'s silent no-op email leg, four orphaned "email service" modules) are dyln-repo issues, correctly out of Foundry's write boundary. Not touched.
