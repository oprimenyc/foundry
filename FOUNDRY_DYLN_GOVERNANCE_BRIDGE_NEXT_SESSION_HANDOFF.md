# Foundry — dyln Governance Bridge: Next Session Handoff

## State at handoff

- Foundry branch `mission/m3-vault-intelligence`, working tree has only this mission's files staged/committed (see commit below) — no unrelated dirty files touched.
- Full suite green: 142 tests, typecheck clean, build clean.
- Three proof scripts added this mission: `proof:local-execution`, `proof:dyln-governance-binding` (Foundry), plus the pre-existing `proof:email-qa-dyln` re-run with the extended evidence contract.

## Known, real (not bridge-caused) gaps to hand to a human, not silently fix

1. **dyln's `follow-up-email` really does send from the wrong address** (`noreply@getdyln.com` vs. every other Tier A template's `support@getdyln.com`). This is dyln's own product gap, documented in dyln's own inventory before this mission started. Foundry's harness correctly FAILs it; do not "fix" it by loosening Foundry's validator — fix it in dyln (out of this mission's write boundary) or explicitly accept it as a known exception.
2. **This mission's own admission/evidence fixtures for dyln (`lib/factory/fixtures/dyln-email-qa.fixture.ts` in VERIDIAN, `DYLN_EMAIL_CONFIG` in Foundry) were hand-transcribed from dyln's real fixture files during this session.** If dyln adds, removes, or changes an email type, these will silently drift out of sync — there is no automated cross-repo sync. Whoever next touches dyln's email fixtures should re-diff against both.

## Coverage gaps, honestly reported

- VERIDIAN's admission axis was exercised only through its pure functions (`evaluateEmailQAInventory`, `buildEmailQAFoundryExport`), not through the Prisma-backed `submitEmailQAInventory` round-trip — no database write was attempted for the dyln fixture (by design, to keep the proof script dependency-free; but it means the DB persistence path itself is unverified for this specific dataset).
- The two new VERIDIAN proof scripts (`dyln-email-qa-admission-proof.ts`, `eve-dyln-email-evidence-proof.ts`) have no matching `tests/e2e/*.spec.ts` Playwright specs — only standalone `node --experimental-strip-types` proof scripts. The *existing* specs that touch the same modules (`factory-email-qa-admission.spec.ts`, `eve-email-evidence.spec.ts`) were re-run as a regression check and passed (53/53), confirming this mission's additions didn't break them, but they don't exercise the new dyln-specific fixture data through the real HTTP/DB path.
- VERIDIAN has no `tsx`/`ts-node` devDependency; this mission added `scripts/ts-alias-loader.mjs`, a small Node ESM resolve hook, so standalone TS proof scripts can use the `@/*` path alias outside Next's bundler. Future scripts of this kind in VERIDIAN should reuse it (`node --experimental-strip-types --experimental-loader ./scripts/ts-alias-loader.mjs <script>.ts`) rather than reinventing path resolution.

## Next safe step (per mission brief)

Run the same governed-bridge pattern for fylr billing evidence and AMOS YouTube provider current-truth/product closure. Suggested approach based on what worked here: (1) read-only current-truth pass over both repos first, identify the closest existing "evidence + policy + verdict" precedent to mirror (as `lib/secret-remediation/` was here), (2) build the new evidence contract additively, (3) build the cross-repo bridge last, once both sides' evidence shapes are locked, and (4) budget time for at least one genuine cross-checking surprise (this mission's reply-to gap) — don't treat the first green run as final; independent verification exists specifically to catch what the first pass missed.
