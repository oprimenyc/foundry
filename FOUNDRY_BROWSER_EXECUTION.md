# FOUNDRY_BROWSER_EXECUTION

**Status:** BOUNDARY_ONLY (honestly blocked)

Foundry has **no browser automation driver provisioned**. `playwright` exists only as a
catalog manifest (category `browser_automation`), not a real adapter, and no Playwright
dependency is installed.

## Current honest behavior

`resolveExecutionMode` (`lib/foundry/routing.ts`) returns mode `BROWSER` with
`executable: false` and the reason "no browser driver provisioned in this runtime —
handoff required". The execution engine **fails such a step loudly** rather than faking a
browser success. Envelope intake surfaces the same as a non-executable boundary.

## To make this REAL (next batch)

1. Add Playwright as a real dependency + a `BrowserProvider` adapter implementing the
   universal contract.
2. Allowlist provider domains; require an authenticated session/profile reference.
3. Implement authenticated-state detection, semantic element lookup, safe form fill,
   confirmation-page validation, approval-before-submit, screenshot evidence, timeout,
   crash recovery, changed-page detection, ambiguity abort.
4. Never bypass MFA/CAPTCHA — route those to the human-gate flow.

Until then, browser operations are reported as blocked, not simulated.
