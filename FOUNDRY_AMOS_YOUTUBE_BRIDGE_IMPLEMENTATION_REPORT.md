# Foundry — AMOS YouTube Package Bridge — Implementation Report

## Files read

- AMOS-CANONICAL (read-only): `backend/src/amos/campaign/contracts.py`, `youtube_package.py`, `youtube_publish_adapter.py`, `pipeline.py`, `backend/src/amos/routes/campaigns.py`, `backend/tests/test_youtube_package.py`, `backend/src/amos/publishing/youtube.py`, `backend/src/amos/routes/youtube.py`, `backend/src/amos/publishing/engine.py`, `proofs/youtube-package/youtube-package.json`, `proofs/youtube-package/PROOF_MANIFEST.json`, `AMOS_YOUTUBE_PROVIDER_{PROOF,TEST_REPORT,IMPLEMENTATION_REPORT,NEXT_SESSION_HANDOFF}.md`.
- Foundry (for pattern-matching): `lib/email-qa/{types,evidence}.ts`, `lib/email-qa/fixtures/dyln-loader.ts`, `lib/provider-actions/{types,operator}.ts`, `lib/foundry/{evidence-manifest,artifacts}.ts`, `lib/secret-remediation/secret-scan.ts`, `scripts/dyln-email-qa-proof.ts`, `tests/email-qa-dyln.test.ts`, `package.json`.

## Files changed / created

| File | Purpose |
|---|---|
| `lib/amos-youtube/types.ts` | Contract types: `AmosYoutubePackage`, `AmosRepoState`, `AmosYoutubeCapabilityCheck`, rejection codes, `AmosYoutubePackageEvidence` |
| `lib/amos-youtube/fixtures/amos-loader.ts` | Read-only loader: git HEAD/branch handshake + `youtube-package.json`/`PROOF_MANIFEST.json` parsing/validation |
| `lib/amos-youtube/evidence.ts` | `buildAmosYoutubePackageEvidence` — capability coverage checklist, rejection-rule enforcement, verdict computation, artifact retention |
| `lib/amos-youtube/operator.ts` | `getAmosYoutubeBridgeOperatorReport` — operator/query surface |
| `scripts/amos-youtube-bridge-proof.ts` | 9-step proof script, writes `proof/evidence/amos-youtube-bridge-proof.json` |
| `tests/amos-youtube-bridge.test.ts` | 9 unit tests |
| `package.json` | Added `proof:amos-youtube-bridge` script |
| `FOUNDRY_AMOS_YOUTUBE_BRIDGE_{CURRENT_TRUTH,PROOF,TEST_REPORT,IMPLEMENTATION_REPORT,NEXT_SESSION_HANDOFF}.md` | Mission report set |

## Design decisions

1. **Read-only, no-source-coupling boundary.** `lib/amos-youtube/fixtures/amos-loader.ts` reads AMOS's committed JSON proof files and does a read-only `git -C <path>` handshake for HEAD/branch — it never imports AMOS Python source and never writes to the AMOS repo. Mirrors `lib/email-qa/fixtures/dyln-loader.ts`'s discipline against dyln exactly.
2. **No live-executor capability, ever.** Following `lib/provider-actions/types.ts`'s "this capability simply does not exist yet anywhere in this module, by design" pattern, nothing in `lib/amos-youtube/` can call a live YouTube/Google API — the loader only parses static JSON, and the evidence builder only reads flags that AMOS's own proof already pinned to `false`.
3. **Fail-closed rejection rules (Phase 3 "must reject" list).** `buildAmosYoutubePackageEvidence` caps the verdict at `BLOCKED` if any of: missing product HEAD, missing package-contract proof, missing dry-run-adapter proof, missing evidence refs, any live-provider flag `true`, a raw secret match, ever fire — regardless of AMOS's own self-reported verdict. A dry-run `PASS` from AMOS is never treated as sufficient on its own.
4. **Capability coverage is independently re-derived, not copied.** Each of the 17 checklist items in `buildCapabilityCoverage` is computed from AMOS's actual package fields (e.g. `pkg.chapters.length > 0`), not asserted as a static `true` — a genuinely incomplete AMOS package would surface as `PASS_WITH_WARNINGS`/`FAIL` here, not a silent pass.
5. **Artifact retention class `RELEASE`**, matching `lib/email-qa/evidence.ts`'s release-blocking artifacts — this evidence is expected to be retained long-term, not ephemeral.

## What was explicitly NOT built

- No API route was added (mission Phase 6 allows a "minimal surface" and says not to build a large UI unless an existing pattern calls for one; `lib/provider-actions/operator.ts` itself has no HTTP route either — plain exported functions are the established pattern here).
- No DB/Prisma persistence — this is a read-only, single-external-product bridge (like the dyln fixture bridge), not a multi-tenant mission feature; nothing in the mission spec calls for schema changes, and adding one would be an unrequested scope expansion.
