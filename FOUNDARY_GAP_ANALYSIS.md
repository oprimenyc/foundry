# FOUNDARY Gap Analysis

Audit date: 2026-07-10

## External document drift

`PRIMEOS_HANDOFF.md` contains stale Foundry claims relative to this repository:
- It says Foundry is `Next.js 14 / Supabase / Redis / BullMQ`; no BullMQ code was found
- It says planner uses `OpenAI GPT-4-turbo`; repo uses Anthropic: [lib/ai/planner.ts](/C:/Users/jp718/foundry/lib/ai/planner.ts:1)
- It says `AWSKMSProvider` is a live no-op stub; repo instead has `LocalKMSProvider`: [lib/security/kms.ts](/C:/Users/jp718/foundry/lib/security/kms.ts:13)

These are documentation drift issues, not repository capabilities.

## Current stop point

Repository truth:
- Foundry can collect a prompt, call the planner API, and render a proposed step list
- Foundry cannot execute those steps end-to-end

Evidence:
- UI fetches `/api/plan` and stores the returned plan: [app/projects/new/page.tsx](/C:/Users/jp718/foundry/app/projects/new/page.tsx:18)
- UI renders `plan.steps` only: [app/projects/new/page.tsx](/C:/Users/jp718/foundry/app/projects/new/page.tsx:87)
- No route or job invokes `SagaOrchestrator`: [lib/orchestration/saga.ts](/C:/Users/jp718/foundry/lib/orchestration/saga.ts:15)

## Critical gaps

| Gap | Why it blocks launch | Evidence |
|---|---|---|
| No execution runtime | Plans are generated but never run | [lib/ai/planner.ts](/C:/Users/jp718/foundry/lib/ai/planner.ts:34), [app/projects/new/page.tsx](/C:/Users/jp718/foundry/app/projects/new/page.tsx:79) |
| No repository creation | Cannot create or initialize source repos | No GitHub adapter or repo creation code found |
| No deployment pipeline | Cannot take a project from plan to deployed artifact | `SagaOrchestrator` unused, Vercel adapter unused |
| No secret persistence/application | Credentials can be encrypted but not stored or applied to providers | [lib/security/kms.ts](/C:/Users/jp718/foundry/lib/security/kms.ts:50) |
| No domain/DNS automation | Cannot launch public product infrastructure | No DNS/domain code found |
| No database provisioning flow | Schema exists, but no provider-side DB creation path exists | [supabase/migrations/0001_init.sql](/C:/Users/jp718/foundry/supabase/migrations/0001_init.sql:10) |
| No verification/release gate | No evidence-based go/no-go mechanism exists in repo | No E.V.E./release gate modules found |

## High gaps

| Gap | Evidence |
|---|---|
| Only one concrete provider adapter exists | [lib/providers/vercel.adapter.ts](/C:/Users/jp718/foundry/lib/providers/vercel.adapter.ts:3) |
| Vercel adapter depends on pre-existing GitHub repo URL | [lib/providers/vercel.adapter.ts](/C:/Users/jp718/foundry/lib/providers/vercel.adapter.ts:19) |
| Persistence is optional and currently absent in runtime | Live `GET /api/healthz` returned `"persistence":"none"` |
| Redis path exists but runtime is using memory bus | Live `GET /api/healthz` returned `"log_bus":"memory"` |
| Planner success path is unverified without Anthropic key | Live `GET /api/healthz` returned `"planner":"missing_api_key"` |
| No deployment history UI | No page for projects/runs/logs beyond planner input page |

## Medium gaps

| Gap | Evidence |
|---|---|
| No browser automation for provider setup | No implementation found |
| No analytics configuration | No implementation found |
| No monitoring configuration | No implementation found |
| No email provider setup | No implementation found |
| No provider config schema beyond prompt output | Plan schema contains only `config` + `steps`: [lib/ai/planner.ts](/C:/Users/jp718/foundry/lib/ai/planner.ts:7) |

## Low gaps

| Gap | Evidence |
|---|---|
| No polished deployment-run UI | Only planner page exists |
| No operator tooling around adapters | No admin or settings surfaces found |

## Adapter gap summary

| System | Status | Gap |
|---|---|---|
| GitHub | Partial | Needs real API adapter and repo/bootstrap flow |
| Vercel | Partial | Needs runtime wiring and verification |
| Supabase | Partial | Needs project/run persistence wiring and optional DB flow |
| Redis | Partial | Needs configured runtime use and deployment event emission |
| Cloudflare | Missing | Needs adapter |
| Railway | Missing | Needs adapter |
| DigitalOcean | Missing | Needs adapter |
| AWS | Missing | Needs adapter |
| Google | Missing | Needs adapter |
| Resend | Missing | Needs adapter |
| SignalWire | Missing | Needs adapter |
| Stripe | Missing | Needs adapter |

## VERIDIAN integration gaps

External docs say VERIDIAN/E.V.E. should absorb Foundry responsibilities, but this repo has no implementation for:
- Runtime Truth engine
- Engineering Evidence store
- Verified Memory
- Decision Ledger
- Release Gate
- E.V.E.
- Knowledge Graph
- Contracts layer

That makes all VERIDIAN integration in this repo `Missing`, except for partial primitives around provider calls and execution logging.
