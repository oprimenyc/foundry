# Foundry — Provider Action Adapter Mega Run: Next Session Handoff

## State at handoff

- Foundry branch `mission/m3-vault-intelligence`, this mission's files committed (see commit below) on top of the prior dyln governance bridge mission's commit.
- Full suite green: 169 tests, typecheck clean, build clean, proof script 37/37.
- New npm script: `proof:provider-actions`.

## What this module deliberately does NOT do (by design, not a gap)

- **No live executor exists anywhere in `lib/provider-actions/`.** Every adapter is dry-run/advisory only, permanently. Adding a live-call path to any adapter here would be a significant, separate, explicitly-approved change — not an incremental extension of this mission's work.
- **A mutating action never reaches a plain `PASS`, even fully approved.** This is intentional (see Implementation Report §2), not an oversight to "fix" by loosening the verdict rule.
- **`dns_advisory` and `git_history_rewrite_advisory` have no path to a real DNS/history change.** The DNS adapter and git-history adapter both describe what a human would need to do; neither can be pointed at a real provider by any input this contract accepts.

## Known, honest gaps

1. **No fixture exercises the `restart_service`/`redeploy_service` action types end-to-end** — they're covered by direct policy unit tests (production-tiering, required gates) and the adapter class itself is exercised implicitly via the registry test, but no Phase-4-style fixture JSON targets them. If a future mission needs a restart/redeploy scenario, add one rather than assuming the existing 10 cover it.
2. **`dyln-staging-env-update-advisory` and the three `foundry-ops-demo`-labeled fixtures (Railway staging, Fly health, Vercel missing-CLI) are not tied to any product's verified real infrastructure** — they're explicitly labeled synthetic in their own `notes` field. Do not later treat them as if they described dyln's, or any product's, actual deployment provider.
3. **PantiCandy's DB credential rotation fixture and vITALCore's three rotation fixtures describe exposures that, per their own source containment docs, are real and still unrotated** (owner action, not yet performed as of this session). This module only prepares the plan — it does not track whether the owner has since acted on it outside Foundry. If this module is extended with a "confirmed rotated" status in the future, these four fixtures are exactly the ones that should be revisited first.
4. **No dedicated `secret-scan` npm script exists in this repo** — every mission in this repo, including this one, uses the same manual grep method. If a dedicated tool is ever added, re-run it against `lib/provider-actions/` specifically.

## Next safe step (per mission brief)

Queue a live-provider approval mission only when the owner explicitly authorizes a specific provider action, starting with GitHub PAT revocation evidence (PantiCandy) or Railway staging env update evidence — both already have a complete, tested dry-run plan sitting in this module's fixtures, ready to be the first real approval decision recorded against once a human reviews it. Building an actual live executor is a distinct, much higher-risk piece of work that should get its own explicit mission brief and its own hard approval gate before a single line of live-call code is written.
