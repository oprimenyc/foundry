# Foundry — AMOS YouTube Package Bridge — Proof

## Command

```
npm run proof:amos-youtube-bridge
```

## Output (verbatim, this session)

```
✓ 1. AMOS repo path/HEAD/branch captured read-only — path=C:\Users\jp718\OneDrive\Desktop\_SORTED\Active_Projects\AMOS-CANONICAL, head=1ae12cf3ec7204c0a593b363ece7e5f23c60620e, branch=integration/amos-zai-canonicalization
✓ 2. AMOS HEAD is at or matches the expected YouTube package commit — expected=1ae12cf3ec7204c0a593b363ece7e5f23c60620e, actual=1ae12cf3ec7204c0a593b363ece7e5f23c60620e
✓ 3. Foundry evidence package built from AMOS's committed proof — evidenceId=art_eafca8497869a26a242c8f0c, verdict=PASS
✓ 4. all required capability coverage fields are present — covered=17
✓ 5. no rejection findings (no live upload, no Google API call, no OAuth/provider mutation, no raw secrets) — clean
✓ 6. final verdict is PASS — verdict=PASS
✓ 7. all live-provider/mutation flags are false — liveYoutubeUploadFlag=false, googleApiCalledFlag=false, oauthMutatedFlag=false, providerMutatedFlag=false, productMutatedFlag=false
✓ 8. operator report reflects the evidence verdict and safety flags — status=PASS
✓ 9. AMOS repo HEAD unchanged after this proof ran — before=1ae12cf3ec7204c0a593b363ece7e5f23c60620e, after=1ae12cf3ec7204c0a593b363ece7e5f23c60620e

All 9 proof steps PASSED. No live YouTube upload, no Google API call, no OAuth/provider mutation, no AMOS mutation.
```

Evidence bundle written to `proof/evidence/amos-youtube-bridge-proof.json` (retained as Foundry artifact `art_eafca8497869a26a242c8f0c`, retention class `RELEASE`).

## What this proves

- AMOS's real, already-committed dry-run YouTube package proof (`proofs/youtube-package/youtube-package.json` + `PROOF_MANIFEST.json`) loads, validates, and maps into Foundry's evidence contract without any AMOS code being imported or any AMOS file being written.
- Every one of the 17 required capability-coverage checks (package contract, video/thumbnail checksum, title, description, tags/hashtags, chapters, pinned comment, playlist recommendation, schedule recommendation, approval state, dry-run verdict, live-upload-blocked, Google-API-disabled, OAuth-disabled, provider-mutation-disabled, evidence refs) is independently confirmed present.
- Every live-provider-action flag (`liveYoutubeUploadFlag`, `googleApiCalledFlag`, `oauthMutatedFlag`, `providerMutatedFlag`, `productMutatedFlag`) is `false`.
- The AMOS repo's git HEAD is identical before and after the proof ran (read-only guarantee, verified by direct `git rev-parse`, not merely asserted).

## What this does NOT prove

- It does not prove AMOS's dry-run package builder is bug-free — that's AMOS's own test suite's job (independently re-run: 309 passed, 10 skipped).
- It does not attempt or simulate a live YouTube publish under any condition — that capability does not exist anywhere in this bridge, by design.
