# FOUNDRY_DYLN_EMAIL_QA_NEXT_SESSION_HANDOFF.md

Supersedes the prior session's `FOUNDRY_EMAIL_QA_NEXT_SESSION_HANDOFF.md` — its "next safe step" is what this mission completed.

## What exists now

Foundry's email QA harness (`lib/email-qa/`) is wired to dyln's real, audited Tier A email fixtures:

- `lib/email-qa/fixtures/dyln.config.ts` — confirmed dyln `ProductEmailConfig` (`sample: false`), 17 real email types, translated criticality.
- `lib/email-qa/fixtures/dyln-loader.ts` — read-only fixture loader + payload mapper + integration-evidence builder (`runDylnEmailQaIntegration`).
- `scripts/dyln-email-qa-proof.ts` (`npm run proof:email-qa-dyln`) — 6/6 steps pass.
- `tests/email-qa-dyln.test.ts` — 7 tests, all passing, covering every mission-required scenario.
- Generic harness gained a product-identity check (`lib/email-qa/validate.ts`), reusable by any future product onboarded the same way.

Full detail: `FOUNDRY_DYLN_EMAIL_QA_CURRENT_TRUTH.md` (mapping decisions), `FOUNDRY_DYLN_EMAIL_QA_IMPLEMENTATION_REPORT.md` (what/why), `FOUNDRY_DYLN_EMAIL_QA_TEST_REPORT.md` / `FOUNDRY_DYLN_EMAIL_QA_PROOF.md` (verification).

## What this is NOT yet

- **Not dyln's real render, verified.** Foundry never imports dyln's source code — it validates the *fixture's declared contract* (sender, links, vars, footer), not dyln's actual live-rendered HTML/text. That verification is dyln's own job (`server/services/__tests__/emailFixtures.test.ts`), already passing in the dyln repo as of HEAD `9f03187b9ec5e5dbe9ba80c781a1b514db62c63b`.
- **Not wired to CI.** `npm run proof:email-qa-dyln` and the two test files are runnable, but nothing gates a Foundry (or dyln) CI pipeline on them yet.
- **The `follow-up-email` sender mismatch is unresolved by design.** dyln's own inventory (gap #3) already flags `noreply@getdyln.com` vs. the canonical `support@getdyln.com` as a real product inconsistency. Foundry surfaces it as a FAIL every run; it is a product decision for dyln to make (pick one canonical sender, or explicitly declare two), not something Foundry should paper over.
- **`paymentNotificationService.ts`'s silent-no-op email gap** (dyln inventory gap, highest severity per dyln's own handoff) still has no tracked follow-up outside dyln's own docs. Out of Foundry's write boundary; worth a deliberate ticket wherever dyln's work is tracked.
- **Resend live-mode remains fully gated** (`FOUNDRY_EMAIL_QA_ALLOW_LIVE_RESEND=explicit-live-send` + code-level `allowLiveSend: true`, both required) — untouched by this mission, still opt-in only, never satisfied by default in CI/test.

## Next safe step

1. If/when dyln flips its `follow-up-email` sender to match `support@getdyln.com` (or Foundry's config is deliberately updated to declare a second allowed sender for that one email type — would require a small, explicit schema change, not a silent config edit), re-run `npm run proof:email-qa-dyln` and confirm the verdict breakdown moves to `17 PASS, 0 FAIL`.
2. Wire `npm test && npm run proof:email-qa-dyln && npm run typecheck && npm run build` into whatever CI gate Foundry uses (none exists yet in this repo as of this session).
3. Only after dyln's own product team makes an explicit sender-identity decision (item 1) — and only against a QA-only Resend account and QA-only recipients, never real customers — should live-mode Resend testing even be discussed. Still fully opt-in, still requires both gates.
4. If more dyln email types are added later (currently 17 Tier A), add them to dyln's own fixture directory first (that's dyln's repo, not Foundry's) — Foundry's loader picks up any new `*.json` file automatically via `readdirSync`, no Foundry-side code change needed unless the new type needs a criticality value outside the existing `release-critical|revenue-critical|high|medium|low` vocabulary.

## Constraints that still apply next session

- No real customer email. No DNS mutation. No paid provider required. No writes outside `C:\Users\jp718\foundry`. `dyln`, `fylr`, `PrimeOpp`, `PantiCandy`, `VERIDIAN`, `PrimeOS`, `NOCTUS`, `AMOS` remain untouched.
- `FOUNDRY_EMAIL_QA_ALLOW_LIVE_RESEND` must stay unset in every CI/test environment.
- `DYLN_REPO_PATH`/`DYLN_EMAIL_FIXTURES_DIR` env overrides exist (`lib/email-qa/fixtures/dyln-loader.ts`) if dyln's repo ever moves on this machine or a CI runner needs a different checkout path — the hardcoded default (`C:\REPLIT PROJECTS\dyln\dyln\...`) is this-machine-specific, not portable.
