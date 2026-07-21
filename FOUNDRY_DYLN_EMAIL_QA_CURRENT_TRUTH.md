# FOUNDRY_DYLN_EMAIL_QA_CURRENT_TRUTH.md

GATE 0/1 checkpoint for the "wire dyln email QA fixtures into Foundry" mission.

## Repo identity

- **Foundry (write boundary):** `C:\Users\jp718\foundry`, branch `mission/m3-vault-intelligence`, starting HEAD `428403f6fa35a0d22f00d26ec36ecc96bc98391b`, working tree clean.
- **dyln (read-only input):** `C:\REPLIT PROJECTS\dyln\dyln`, branch `feat/v1-deterministic-layer`, HEAD `9f03187b9ec5e5dbe9ba80c781a1b514db62c63b`.
  - Working tree has pre-existing dirty/untracked files (deployment logs, `graphify-out/*`, proof artifacts under `artifacts/`, status reports) — all unrelated to email QA, not touched, not staged, not read beyond directory listing.
  - The specific paths this mission consumes (`server/services/__fixtures__/email/*`, `DYLN_EMAIL_QA_INVENTORY.md`, `DYLN_FOUNDRY_EMAIL_QA_HANDOFF.md`) are clean (`git status --porcelain` empty for those paths) and were introduced in a single commit, `9f03187` ("prepare dyln email qa harness fixtures"). The inventory doc's own text says "as of HEAD `7609133`" — confirmed via `git merge-base --is-ancestor` that `7609133` is an ancestor of current HEAD, so no conflict; the fixture commit is simply newer than the prose reference inside it.
  - No dyln file was modified, staged, or committed by Foundry at any point in this mission.

## What already existed in Foundry (prior session, commit `428403f`)

A working, tested, provider-neutral email QA harness: `lib/email-qa/{types,validate,inbox,evidence}.ts`, `lib/email-qa/adapters/{local-fixture,resend-boundary,types}.ts`, one placeholder product config (`lib/email-qa/fixtures/dyln.sample-config.ts`, `sample: true`, RFC 2606 `dyln.example` domain), `tests/email-qa.test.ts` (11/11 passing), `scripts/email-qa-proof.ts` (`npm run proof:email-qa`, 6/6 steps). Contract documented in `FOUNDRY_EMAIL_QA_CONTRACT.md`. This mission builds on top of it without modifying its design.

## What dyln handed off (read-only)

- `DYLN_FOUNDRY_EMAIL_QA_HANDOFF.md` + `DYLN_EMAIL_QA_INVENTORY.md` — narrative contract and full per-email inventory (17 Tier A live emails + 7 Tier B provider-managed/orphaned, documented but explicitly out of fixture scope).
- `server/services/__fixtures__/email/*.json` (17 files) + `index.ts` (typed loader/shape-validator) + `README.md` (schema/rules) — one `EmailFixture` JSON per Tier A email, all recipients on the `@dyln.test` reserved domain, no secrets, no real dyln inbox ever a recipient.
- dyln's own test (`server/services/__tests__/emailFixtures.test.ts`) mocks `resend`/`nodemailer`/Firestore and asserts against these fixtures by actually calling dyln's real `emailService.ts`/`emailFollowUpService.ts` functions. **Foundry does not do this** — see scope boundary below.

## Scope boundary: what Foundry's QA actually proves

Foundry never imports dyln source code (no cross-repo TS dependency, no dyln toolchain/Firestore/Stripe deps pulled into Foundry). It only `readFileSync`/`readdirSync`s the static `*.json` fixture files (dyln handoff's explicitly-endorsed option "(b) treat the `*.json` files as a language-agnostic data contract"), then synthesizes a self-consistent `EmailPayload` from each fixture's own declared fields (sender, reply-to, required vars/links, subject substrings, footer flags) and runs Foundry's independent, generic validator against it.

- A Foundry **PASS** means: the fixture's declared contract is well-formed, internally consistent, and conforms to Foundry's provider-neutral email-QA contract once mapped through a documented, deterministic mapping.
- A Foundry **PASS does not mean**: dyln's real, live-rendered HTML/text output is bug-free — that is what dyln's own `emailFixtures.test.ts` proves, by actually executing dyln's render functions. The two suites are complementary, not redundant.
- Template-variable values not literally present in a fixture's `args` (e.g. `firstName` derived server-side from `displayName`) are filled with a clearly-synthetic `qa-synth-<var>` placeholder by Foundry's mapper, not a reproduction of dyln's real interpolation logic. This is stated explicitly in code comments and in the implementation report.

## Key mapping decisions (recorded, not silently assumed)

1. **Single canonical sender, not two.** dyln's real Tier A emails use `support@getdyln.com` for 16 of 17 fixtures and `noreply@getdyln.com` for one (`follow-up-email`, a separate module/service) — an inconsistency dyln's own inventory already flags (gap #3) and explicitly asks Foundry not to "fix" by normalizing expectations. Foundry's product-config schema supports exactly one canonical `sender.fromAddress` per product. Decision: config canon is `support@getdyln.com`; `follow-up-email` is expected to (and does) surface a real `SENDER_MISMATCH` **FAIL** — this is the harness correctly doing its job, not a wiring defect. Recorded here so it is never mistaken for one.
2. **No product-wide required footer link.** 13 of 17 dyln emails go through `emailShell()` (unsubscribe + copyright footer); 4 hand-rolled templates (`contact-sales-*`, `waitlist-admin-notification`, `follow-up-email`) have no footer at all. Foundry's `requiredFooterLinks` is a single product-wide list with no per-email-type override. Decision: leave `requiredFooterLinks: []` at the product-config level and push the real unsubscribe link (`https://getdyln.com/unsubscribe`) into each fixture's own per-payload `requiredLinks` only when that fixture's `legalFooter.unsubscribe` is `true` — using the schema's existing per-payload extension point instead of changing the shared contract.
3. **No reply-to enforced.** All 17 fixtures have `replyToExplicit: false` (Resend's implicit from-address default is relied on, no code sets a `reply_to` header). Decision: `sender.replyTo` left `undefined` in the config (matches "assert absent, not present" from the dyln handoff) rather than declaring an expected reply-to that no payload will ever set.
4. **Criticality vocabulary translation.** dyln's fixtures use `release-critical | revenue-critical | high | medium | low`; Foundry's contract uses `low | standard | high | release-blocking` + a separate `releaseBlocking` boolean. Decision (documented in `lib/email-qa/fixtures/dyln-loader.ts`): `release-critical`/`revenue-critical` → Foundry `release-blocking` + `releaseBlocking: true`; `high` → `high`/`false`; `medium` → `standard`/`false`; `low` → `low`/`false`. Revenue-critical mapping to release-blocking follows PrimeOS Constitution §2 (revenue-first prioritization).
5. **Product-identity check was missing from the shared validator.** `runEmailQaValidation` never compared `payload.productId` against `config.productId` — a latent gap where a payload could silently validate against the wrong product's config. Added as a small, generic, additive check (not dyln-specific) since mission Task 2 explicitly asks for product-identity validation.
6. **Link-path host is synthetic.** dyln's fixtures list host-agnostic path suffixes (e.g. `/dashboard`) because `APP_URL` varies by environment; Foundry's link check is a raw substring match (`renderedBody.includes(link)`), so the exact synthetic host prefix Foundry attaches doesn't affect correctness — only the path suffix, which is what the fixture actually asserts, is meaningful.

## Foundry evidence/artifact conventions reused (no new storage backend)

`retainArtifact`/`listArtifacts` (`lib/foundry/artifacts.ts`, content-addressed, redacted-before-hash, retention-classed) and `sha256Canonical`/`canonicalJson` (`lib/foundry/evidence-manifest.ts`) are reused as-is for the new dyln integration evidence bundle, exactly as the existing harness already does for per-email evidence packages and inbox messages.

## Conclusion

No dyln file was or will be modified. The wiring is additive: one renamed/rewritten confirmed dyln config, one new fixture-loader module, one new proof script, one new test file, plus a small generic addition (product-identity check) to the existing shared validator — all inside `C:\Users\jp718\foundry`.
