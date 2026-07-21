# Foundry — AMOS YouTube Package Bridge — Next Session Handoff

## What exists

- A read-only Foundry evidence bridge (`lib/amos-youtube/`) that turns AMOS's own committed dry-run YouTube package proof into Foundry's standardized, artifact-retained evidence package, with a full capability-coverage checklist and fail-closed rejection rules.
- An operator/query surface (`lib/amos-youtube/operator.ts`) and a proof script (`npm run proof:amos-youtube-bridge`) that both currently report `PASS` against the real AMOS commit `1ae12cf3ec7204c0a593b363ece7e5f23c60620e`.
- A cross-repo chain to VERIDIAN: this Foundry evidence file (`proof/evidence/amos-youtube-bridge-proof.json`) is read by VERIDIAN's E.V.E. bridge (`src/lib/eve/amos-youtube-evidence-bridge.ts`) and independently re-verified there.

## What this is NOT

- Not a live YouTube publisher. There is no code path anywhere in `lib/amos-youtube/` that can call a Google/YouTube API, mutate OAuth, or mutate provider state — that capability doesn't exist here by design, matching `lib/provider-actions/`'s discipline.
- Not a guarantee that AMOS's separate, dormant `YouTubePublisher` (`backend/src/amos/publishing/youtube.py`) is safe to wire up — that client was read during Phase 1 but is out of scope for this bridge entirely.
- Not a Foundry-side consumer of VERIDIAN's admission export (`AmosYoutubeFoundryExport`) — that payload exists on the VERIDIAN side with `foundrySupport: "pending"` and is not yet read by anything in this repo. A future session could wire that up if a genuine need arises.

## Next safe step

Continue with the fylr billing governance bridge or dyln TypeScript stabilization (per mission's own next-step guidance). If extending this bridge specifically: consider whether Foundry should start consuming VERIDIAN's `AmosYoutubeFoundryExport` payload as an input (currently one-directional: Foundry reads AMOS, VERIDIAN reads Foundry — VERIDIAN's admission axis is not yet consumed anywhere). Do not run any live YouTube or Google provider action without explicit human approval outside this bridge.

## Constraints that still apply

- No live YouTube upload, no Google API call, no OAuth mutation, no provider mutation — none of these exist in this module's code paths, and any future change that would add one requires the same explicit-approval-gate discussion as `lib/provider-actions/`.
- AMOS remains read-only from Foundry's side. Any AMOS-side change must happen in the AMOS repo itself, by AMOS's own maintainers/session.
