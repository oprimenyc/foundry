# FOUNDRY_EMAIL_QA_NEXT_SESSION_HANDOFF.md

## What exists now

A working, tested, free/local email QA harness at `lib/email-qa/` — contracts
(`types.ts`), validator (`validate.ts`), outbound adapter boundary
(`adapters/local-fixture.adapter.ts`, `adapters/resend-boundary.adapter.ts`),
virtual inbox (`inbox.ts`), evidence assembly (`evidence.ts`), and one sample
product config (`fixtures/dyln.sample-config.ts`, `sample: true`). Covered by
`tests/email-qa.test.ts` (11/11 pass) and `scripts/email-qa-proof.ts`
(`npm run proof:email-qa`, 6/6 steps pass). See `FOUNDRY_EMAIL_QA_CONTRACT.md`
for the contract, `FOUNDRY_EMAIL_QA_IMPLEMENTATION_REPORT.md` for what was
built and why, `FOUNDRY_EMAIL_QA_TEST_REPORT.md` / `FOUNDRY_EMAIL_QA_PROOF.md`
for verification detail.

## What this is NOT yet

- Not wired to any real product repo. `dyln.sample-config.ts` is a shape
  placeholder using the `dyln.example` fixture domain — nobody has confirmed
  dyln's actual sender identity, real email-type list, or real footer links
  against it yet.
- Not wired to a UI, CLI command, or CI gate. It's a library + tests + a
  standalone proof script today.
- The Resend boundary (`adapters/resend-boundary.adapter.ts`) has never made
  a real network call in this repo, by design — it has only been exercised
  against a stub client.

## Next safe step

Wire dyln's actual email templates into this harness and run the first
product-specific branded-email proof without any production customer sends:

1. Get dyln's real sender identity, reply-to, footer/legal links, and actual
   email-type list (this session's `dyln.sample-config.ts` fields are
   placeholders, not confirmed values) — from the dyln team/repo, without
   modifying the dyln repository itself (Foundry's write boundary is this
   repo only).
2. Replace `dyln.sample-config.ts`'s placeholder values with the confirmed
   ones and flip `sample: false` once a human has confirmed they're correct
   — do not flip it based on inference alone.
3. Feed dyln's actual rendered email payloads (from dyln's real template
   render, not hand-written fixtures) through `runEmailQaAndProduceEvidence`
   using the `LocalFixtureAdapter` — still no real Resend call — and confirm
   every dyln email type gets a `PASS` or an explainable `PASS_WITH_WARNINGS`.
4. Only after that proof is clean should live-mode Resend testing even be
   discussed, and only against a test/QA Resend account and QA-only
   recipient addresses — never a real customer.

## Constraints that still apply next session

- No real customer email. No DNS mutation. No paid provider required. No
  writes outside `C:\Users\jp718\foundry`. `dyln`, `fylr`, `PrimeOpp`,
  `PantiCandy`, `VERIDIAN`, `PrimeOS`, `NOCTUS`, `AMOS` remain untouched.
- `FOUNDRY_EMAIL_QA_ALLOW_LIVE_RESEND` must stay unset in every CI/test
  environment; it exists so a human can deliberately opt a specific run into
  a real send later, never so a default run silently could.
