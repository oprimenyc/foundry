# Foundry — AMOS YouTube Package Bridge — Current Truth

## Repo state at mission start

- **Foundry repo:** `C:\Users\jp718\foundry`
- **Branch:** `mission/m3-vault-intelligence`
- **Starting HEAD:** `21a208653e8881e5aa8fa81740f0439e9630b4ef`
- **Dirty tree at start:** clean (`git status --porcelain` empty)

- **VERIDIAN repo:** `C:\Users\jp718\Downloads\workspace-847129d7-6103-4bd5-bf51-eaa3c760dd0f`
- **Branch:** `mission/eve-plan-review`
- **Starting HEAD:** `ecb73755328e1c257e733a3bf9baac2b6d517592`
- **Dirty tree at start:** large — ~13 modified `evidence/*.json` fixtures plus dozens of untracked root-level files (`ECOSYSTEM_CENSUS.*`, `DYLN_*`, `FACTORY_*`, `CAPABILITY_*`, etc.), unrelated to this mission. Preserved untouched; never staged.

- **AMOS repo (read-only):** `C:\Users\jp718\OneDrive\Desktop\_SORTED\Active_Projects\AMOS-CANONICAL`
- **Branch:** `integration/amos-zai-canonicalization`
- **HEAD:** `1ae12cf3ec7204c0a593b363ece7e5f23c60620e` (matches the mission's expected YouTube-ready package commit exactly)
- **Working tree:** clean

## Relevant prior capabilities detected in Foundry

Recent commits established a repeatable "governance bridge" pattern this mission follows exactly:
- `add governed secret remediation workflow`
- `add local execution evidence and dyln email bridge`
- `add approval gated provider action adapters`
- `correct replit deployment classification`
- `refresh dyln email sender evidence`

Each bridge is a `lib/<feature>/` module (types/evidence/operator, optional fixtures/adapters) + a `scripts/<feature>-proof.ts` + a `tests/<feature>.test.ts` + a 5-doc report set + an `npm run proof:<feature>` script. This mission's `lib/amos-youtube/` module follows the same shape, modeled most closely on `lib/email-qa/fixtures/dyln-loader.ts` (read-only cross-repo fixture ingestion) and `lib/provider-actions/` (evidence/operator scaffold, "no live executor exists" discipline).

## AMOS read-only status

AMOS was read-only for the entire mission. No file under the AMOS-CANONICAL repo was created, edited, or deleted. Confirmed by re-checking `git rev-parse HEAD` before and after every Foundry proof run: unchanged at `1ae12cf3ec7204c0a593b363ece7e5f23c60620e`.

## AMOS YouTube package evidence discovered (Phase 1 inventory)

- **Contract:** `backend/src/amos/campaign/contracts.py:540-746` — `YouTubeReadyPackage` (schema `amos.youtube-ready-package.v1.0.0`), covers every mission-required field (video/thumbnail checksummed refs, title, description, tags/hashtags, chapters, pinned comment, playlist recommendation, schedule window, approval state, `provider_mutation_flag: Literal[False]`, `dry_run_publish_status` with all mutation flags `Literal[False]`).
- **Builder:** `backend/src/amos/campaign/youtube_package.py` (`build_youtube_ready_package`), wired into `backend/src/amos/campaign/pipeline.py:254-266`.
- **Dry-run adapter:** `backend/src/amos/campaign/youtube_publish_adapter.py` — no import of `httpx`/`googleapiclient`/`requests`/`urllib`; all result flags hard-coded `False`.
- **Operator surface:** `GET /api/v1/campaigns/{campaign_id}/youtube-package` (`backend/src/amos/routes/campaigns.py:131-147`).
- **Evidence package:** `proofs/youtube-package/youtube-package.json` + `proofs/youtube-package/PROOF_MANIFEST.json`, plus `AMOS_YOUTUBE_PROVIDER_{PROOF,TEST_REPORT,IMPLEMENTATION_REPORT,CURRENT_TRUTH,NEXT_SESSION_HANDOFF}.md`.
- **Tests:** independently re-run during this mission: `backend/tests/test_youtube_package.py` → 17/17 passed; full backend suite → 309 passed, 10 skipped (matches AMOS's own committed `PROOF_MANIFEST.json`).
- A separate, real OAuth2/YouTube Data API v3 client exists (`backend/src/amos/publishing/youtube.py`, `backend/src/amos/routes/youtube.py`) but is confirmed **not wired** to the campaign/package pipeline used here — dormant, out of scope, never invoked by this bridge.
- Live YouTube upload confirmation: **NO**. Google API call confirmation: **NO**. OAuth mutation confirmation: **NO**. Provider mutation confirmation: **NO**. Product mutation confirmation: **NO**. Secret storage confirmation: **NO** (secret scan clean).

## Remaining mission work at the time this doc was written

Phases 2–7 (VERIDIAN admission/E.V.E., Foundry evidence package, cross-repo binding, operator surface, tests/proof, reports, commits) — tracked and completed in this same session; see `FOUNDRY_AMOS_YOUTUBE_BRIDGE_IMPLEMENTATION_REPORT.md` for the final state.
