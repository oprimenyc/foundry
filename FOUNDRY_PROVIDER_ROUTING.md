# FOUNDRY_PROVIDER_ROUTING

**Module:** `lib/foundry/routing.ts` · **Status:** VERIFIED

Every operation is routed through an explicit, persisted execution mode. Foundry
**never silently falls back** from one mode to another.

## Modes

| Mode | When | `executable` |
|------|------|--------------|
| `API` | Live or mock provider adapter declares the action | `true` |
| `BROWSER` | `browser_automation` category | `false` — no driver provisioned (honest handoff) |
| `HUMAN` | Interactive handoff actions (accept_terms, captcha, passkey, mfa_enroll) | `false` |
| `UNSUPPORTED` | Unknown provider, unavailable runtime status, or undeclared action | `false` |
| `CLI` | (reserved) no Foundry adapter is CLI-driven today | — |

`resolveExecutionMode({providerId, action, environment})` returns `{mode, executable,
requiresHumanGate, reasons[], category}`. `requiresHumanGate` is set for high/critical-risk
actions (via `classifyActionRisk`, production-aware) and pure handoff actions.

## Enforcement in the engine

`executeRun` calls `resolveExecutionMode` per step, records the choice to the event log
(`Routing <provider>.<action> via <MODE> (<reasons>)`), and **fails the step loudly** if
`executable` is false — it never pretends a weaker mode succeeded.

## Honesty

`BROWSER` and `HUMAN` return `executable: false` because Foundry has no browser driver
and cannot perform interactive human steps itself. This is BOUNDARY_ONLY by design, and
it is reported, not simulated. Tested in `tests/operations.test.ts` (API/UNSUPPORTED/gate).
