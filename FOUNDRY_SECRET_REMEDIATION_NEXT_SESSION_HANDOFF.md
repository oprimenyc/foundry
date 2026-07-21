# FOUNDRY_SECRET_REMEDIATION_NEXT_SESSION_HANDOFF.md

## What exists now

A working, tested, governed secret exposure remediation orchestrator at
`lib/secret-remediation/` — contract (`types.ts`), raw-secret rejection
(`secret-scan.ts`), plan engine (`plan.ts`), approval gates (`gates.ts`), six
dry-run adapters (`adapters/`), evidence assembly (`evidence.ts`), 6 real-world
fixture cases from PantiCandy/vITALCore (`fixtures/`), and an operator surface
(`operator.ts` + `app/api/secret-remediation/route.ts`). Covered by
`tests/secret-remediation.test.ts` (13/13 pass) and
`scripts/secret-remediation-proof.ts` (`npm run proof:secret-remediation`,
9/9 steps pass). See `FOUNDRY_SECRET_REMEDIATION_CURRENT_TRUTH.md` for the
source-of-truth read, `FOUNDRY_SECRET_REMEDIATION_IMPLEMENTATION_REPORT.md`
for what was built and why, `FOUNDRY_SECRET_REMEDIATION_TEST_REPORT.md` /
`FOUNDRY_SECRET_REMEDIATION_PROOF.md` for verification detail.

## What this is NOT yet

- Not wired to a live rotation path of any kind — every adapter is
  advisory-only and has no live-mode escape hatch at all (unlike the
  email-qa Resend boundary, which does have one behind two explicit flags).
  This is deliberate for this mission, not an oversight.
- Not wired to a UI, CLI command, or CI gate. It's a library + API route +
  tests + a standalone proof script today.
- Gate state (`lib/secret-remediation/gates.ts`) lives in a `globalThis`-backed
  in-process store, not the durable `FoundryStore`/SQLite/file persistence
  used by `lib/foundry/human-gates.ts`. A pending gate does **not** survive a
  process restart today — acceptable for this mission (no execution engine to
  resume), but worth knowing before treating gate state as durable across
  deploys.
- The mission brief's abbreviated commit hashes (`7494cc1`, `a05bb43`,
  `e664ccf`, `0747671`) did not all verify against the source docs read this
  session — see the "Conflict recorded, not silently resolved" note in
  `FOUNDRY_SECRET_REMEDIATION_CURRENT_TRUTH.md`. The fixtures use the hashes
  actually quoted in each source doc instead.

## Next safe step

Add live provider adapters behind explicit approval gates, starting with
GitHub PAT remediation and deployment environment update evidence:

1. Design a **second**, opt-in adapter class per provider (e.g.
   `GitHubPatLiveRemediationAdapter`) that only activates when both a
   code-level `allowLiveAction: true` opt-in and a dedicated env flag (a new
   name, distinct from `FOUNDRY_ALLOW_MOCKS` and
   `FOUNDRY_EMAIL_QA_ALLOW_LIVE_RESEND` — e.g.
   `FOUNDRY_SECRET_REMEDIATION_ALLOW_LIVE_ACTION`) are both set — mirroring
   the two-gate pattern already proven safe in
   `lib/email-qa/adapters/resend-boundary.adapter.ts`. The advisory-only
   adapters built this session stay as the default/dry-run path; live
   adapters are strictly additive.
2. A live adapter must still pass through `gates.ts`: it may only execute
   after the specific `RemediationGateRecord` it corresponds to is
   `"approved"`, checked at call time, not assumed from the plan alone.
3. Before rotating a real GitHub PAT for real, get explicit human
   confirmation of exactly which token/repo is being acted on — the fixture
   findings in this session never named a specific live token, only a
   category and a repo path.
4. Persist gate state durably (extend `lib/foundry/store.ts`'s `FoundryStore`
   with a `remediationGates` collection, or keep the current in-process store
   but document the restart-loses-pending-gates behavior loudly) before any
   live adapter goes near a real credential — a gate that silently reverts to
   "unknown" after a restart is not a safe precondition for revocation.

## Constraints that still apply next session

- No real GitHub/Supabase/Neon/Google/Railway API call without both explicit
  gates from step 1 above, and only after the corresponding `gates.ts` record
  is `"approved"`.
- No secret value ever read, stored, or printed — `secret-scan.ts`'s
  rejection and the `AUDIT`-retention evidence artifacts stay exactly as they
  are; a live adapter's own request/response must be redacted before it ever
  touches an evidence artifact, the same way `retainArtifact` already
  redacts before hashing.
- No writes outside `C:\Users\jp718\foundry`. PantiCandy, vITALCore, PrimeOS,
  dyln, VERIDIAN, fylr, PrimeOpp, NOCTUS, AMOS remain untouched.
- No git history rewrite or force-push performed by Foundry itself, ever —
  that stays a human-executed, explicitly-approved-per-instance action no
  matter how far the live-adapter work above progresses.
