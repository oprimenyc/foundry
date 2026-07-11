# FOUNDARY Implementation Roadmap

This roadmap is derived from repository gaps only. It does not assume architecture that is not present.

## Recommended implementation order

1. Connect plan output to execution
   Evidence: planner exists, but execution stops at UI rendering
   Files: [app/projects/new/page.tsx](/C:/Users/jp718/foundry/app/projects/new/page.tsx:79), [lib/orchestration/saga.ts](/C:/Users/jp718/foundry/lib/orchestration/saga.ts:15)

2. Persist projects, runs, and execution state
   Evidence: optional Supabase seam and schema exist, but are unused
   Files: [lib/db/supabase.ts](/C:/Users/jp718/foundry/lib/db/supabase.ts:6), [supabase/migrations/0001_init.sql](/C:/Users/jp718/foundry/supabase/migrations/0001_init.sql:10)

3. Wire real deployment logs into the existing SSE path
   Evidence: log bus and SSE route exist without a deployment runner using them
   Files: [lib/logs/bus.ts](/C:/Users/jp718/foundry/lib/logs/bus.ts:15), [app/api/projects/[id]/logs/route.ts](/C:/Users/jp718/foundry/app/api/projects/[id]/logs/route.ts:6)

4. Add repository creation/bootstrap capability
   Evidence: Vercel adapter requires a GitHub repo URL, but no repo creation exists
   Files: [lib/providers/vercel.adapter.ts](/C:/Users/jp718/foundry/lib/providers/vercel.adapter.ts:11)

5. Wire Vercel adapter into the runtime
   Evidence: adapter exists but has no call sites
   Files: [lib/providers/vercel.adapter.ts](/C:/Users/jp718/foundry/lib/providers/vercel.adapter.ts:3)

6. Add secret storage and provider credential application
   Evidence: encryption exists, but no storage/application path exists
   Files: [lib/security/kms.ts](/C:/Users/jp718/foundry/lib/security/kms.ts:50)

7. Add additional provider adapters
   Evidence: no implementations found for Cloudflare, Railway, Google, email providers, or DNS

8. Add verification and release controls
   Evidence: no repository implementation found for E.V.E./release gate/runtime certification

## Quickest wins

1. Use `SagaOrchestrator` from an API route or worker
2. Save planner output to the existing `projects` table shape
3. Surface deployment logs in UI using `useDeploymentStream`
4. Add tests for a mocked orchestration run
5. Add a GitHub adapter matching the Vercel repo dependency
6. Add environment/config status for `VERCEL_API_TOKEN`
7. Persist encrypted secrets with `SecretsService`
8. Track run status transitions in persistence
9. Add adapter registry validation against planner step providers
10. Add smoke coverage for one happy-path mocked execution

## Effort outlook

Near-term:
- Making Foundry a minimally real launcher requires wiring together modules that already exist but are isolated

Longer-term:
- Full SaaS launch automation still requires multiple new adapters and a real execution model for repo creation, deployment, secrets, DNS, email, and verification

## What should not be overstated

Do not claim the following until runtime evidence exists:
- End-to-end deployment orchestration
- Secret management beyond local encryption primitives
- Supabase-backed persistence in live runtime
- Vercel deployment execution
- Any GitHub, DNS, email, or browser automation capability
- Any VERIDIAN or E.V.E. integration
