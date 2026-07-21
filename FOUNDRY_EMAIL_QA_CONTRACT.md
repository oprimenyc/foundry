# FOUNDRY_EMAIL_QA_CONTRACT.md

**Foundry Email QA Contract — provider-neutral.**
**Source of truth:** `lib/email-qa/types.ts`

Same design rule as `docs/PROVIDER_INTERFACE.md`: nothing in this contract names
a vendor. A `ProductEmailConfig` describes what a correct email looks like for
one product; an `EmailPayload` is one concrete email checked against it. Only
`lib/email-qa/adapters/*` know about transport (fixture vs. Resend).

## ProductEmailConfig — every product declares

| Field | Meaning |
|---|---|
| `productId` / `productName` | which product this config governs (`dyln`, `fylr`, `PrimeOpp`, `PantiCandy`, `vITAL Core`, ...) |
| `sender` | branded `fromAddress` / `fromName` / `replyTo` this product is expected to use |
| `allowedFromDomains` | domains a `from` address must belong to |
| `emailTypes` | the triggers this product sends (welcome, password_reset, ...), each with `criticality` and `releaseBlocking` |
| `requiredFooterLinks` | links every email must resolve (unsubscribe, privacy, terms, ...) |
| `requiredLegalText` | required legal/footer text snippets |
| `releaseBlockingRules` | which checks are mandatory and how missing-asset severity is decided |
| `sample` | `true` until the owning product repo is actually wired to this harness |

## EmailPayload — one concrete email under test

| Field | Meaning |
|---|---|
| `productId` / `emailType` | which config and trigger this payload claims to be |
| `recipient` | `{ type: customer\|internal\|admin\|test, address }` |
| `from` / `fromName` / `replyTo` | sender identity as actually set on this email |
| `subject` | subject line |
| `templateInputs` | the variables used to render the body |
| `renderedBody` | the fully rendered body (may still contain unresolved placeholders — that's what we're checking for) |
| `requiredLinks` / `requiredAssets` | link/asset expectations specific to this email, on top of the product's standing footer links |
| `headers` | raw headers preserved where available |

## Criticality and release-blocking rules

`EmailTypeDefinition.criticality` is `low | standard | high | release-blocking`.
`EmailTypeDefinition.releaseBlocking` decides how a validation **error** on that
email type surfaces as a verdict:

- error + `releaseBlocking: true` → **BLOCKED**
- error + `releaseBlocking: false` → **FAIL**
- warning only → **PASS_WITH_WARNINGS**
- nothing raised → **PASS**

`ReleaseBlockingRules.missingAssetSeverity` decides whether a missing asset is
an `error` or a `warning` for email types that are not themselves release-blocking.

## Evidence package — every QA run outputs

`EmailQaEvidencePackage` (see `lib/email-qa/types.ts`): product config hash,
rendered payload hash, full validation breakdown (sender / reply-to /
placeholder / link / asset / template-var checks), the virtual inbox message
id the run produced, delivery/event correlation when an adapter actually ran,
and the final verdict — `PASS | FAIL | BLOCKED | PASS_WITH_WARNINGS`.

## Honesty rules (same spirit as `PROVIDER_INTERFACE.md`)

- The Resend adapter boundary never calls the real Resend API unless both an
  explicit env flag and explicit test-mode flag are set (see
  `lib/email-qa/adapters/resend-boundary.adapter.ts`). Default is local/fixture.
- A `sample: true` product config is not a claim about the real product's
  email setup — it's a fixture until that product's repo is wired.
- Missing/unknown checks never pass silently — every check contributes to the
  verdict; an unresolved placeholder or missing sender is always an error, not
  a warning, regardless of criticality.
