# FOUNDARY Feature Matrix

Audit date: 2026-07-10

External doc drift noted:
- `PRIMEOS_HANDOFF.md` describes a different Foundry state than this repository now shows
- Repository truth wins where they conflict

| Area | Capability | Status | Evidence |
|---|---|---|---|
| App shell | `/` redirects to planner | Operational | [app/page.tsx](/C:/Users/jp718/foundry/app/page.tsx:8), [scripts/smoke.mjs](/C:/Users/jp718/foundry/scripts/smoke.mjs:32) |
| App shell | Planner page loads | Operational | [app/projects/new/page.tsx](/C:/Users/jp718/foundry/app/projects/new/page.tsx:36), [scripts/smoke.mjs](/C:/Users/jp718/foundry/scripts/smoke.mjs:38) |
| App shell | Foundry branding present | Operational | [app/layout.tsx](/C:/Users/jp718/foundry/app/layout.tsx:4), [README.md](/C:/Users/jp718/foundry/README.md:1) |
| Planning | Prompt validation | Operational | [app/api/plan/route.ts](/C:/Users/jp718/foundry/app/api/plan/route.ts:7), [scripts/smoke.mjs](/C:/Users/jp718/foundry/scripts/smoke.mjs:45) |
| Planning | Anthropic-backed plan generation | Partial | [lib/ai/planner.ts](/C:/Users/jp718/foundry/lib/ai/planner.ts:34), missing API key at runtime via [app/api/healthz/route.ts](/C:/Users/jp718/foundry/app/api/healthz/route.ts:10) |
| Planning | Plan display in UI | Operational | [app/projects/new/page.tsx](/C:/Users/jp718/foundry/app/projects/new/page.tsx:79) |
| Orchestration | Saga engine with rollback | Stub | [lib/orchestration/saga.ts](/C:/Users/jp718/foundry/lib/orchestration/saga.ts:15), no call sites found |
| Logging | SSE log stream endpoint | Operational | [app/api/projects/[id]/logs/route.ts](/C:/Users/jp718/foundry/app/api/projects/[id]/logs/route.ts:6), [scripts/smoke.mjs](/C:/Users/jp718/foundry/scripts/smoke.mjs:69) |
| Logging | In-memory log bus | Partial | [lib/logs/bus.ts](/C:/Users/jp718/foundry/lib/logs/bus.ts:20) |
| Logging | Redis log bus | Partial | [lib/logs/bus.ts](/C:/Users/jp718/foundry/lib/logs/bus.ts:33) |
| Logging | Client log consumption hook | Stub | [components/deployment/use-deployment-stream.ts](/C:/Users/jp718/foundry/components/deployment/use-deployment-stream.ts:5), no call sites found |
| Providers | Generic provider HTTP client | Partial | [lib/providers/http-client.ts](/C:/Users/jp718/foundry/lib/providers/http-client.ts:10) |
| Providers | Vercel project create/delete | Partial | [lib/providers/vercel.adapter.ts](/C:/Users/jp718/foundry/lib/providers/vercel.adapter.ts:11), no call sites found |
| Providers | GitHub integration | Missing | Only indirect repo string in Vercel adapter: [lib/providers/vercel.adapter.ts](/C:/Users/jp718/foundry/lib/providers/vercel.adapter.ts:19) |
| Providers | Railway integration | Missing | No implementation found |
| Providers | Cloudflare integration | Missing | Only prompt example in [lib/ai/planner.ts](/C:/Users/jp718/foundry/lib/ai/planner.ts:32) |
| Providers | DigitalOcean integration | Missing | No implementation found |
| Providers | AWS integration | Missing | No adapter found; removed stub mentioned in [lib/security/kms.ts](/C:/Users/jp718/foundry/lib/security/kms.ts:4) |
| Providers | Google integration | Missing | No implementation found |
| Providers | Resend integration | Missing | No implementation found |
| Providers | SignalWire integration | Missing | No implementation found |
| Providers | Stripe integration | Missing | No implementation found |
| Data | Supabase admin client | Partial | [lib/db/supabase.ts](/C:/Users/jp718/foundry/lib/db/supabase.ts:6) |
| Data | Organizations/projects/api_keys schema | Stub | [supabase/migrations/0001_init.sql](/C:/Users/jp718/foundry/supabase/migrations/0001_init.sql:3) |
| Security | Local KMS provider | Partial | [lib/security/kms.ts](/C:/Users/jp718/foundry/lib/security/kms.ts:13) |
| Security | Secret encryption/decryption | Partial | [lib/security/kms.ts](/C:/Users/jp718/foundry/lib/security/kms.ts:50) |
| Security | API key generation/hashing | Stub | [lib/security/api-keys.ts](/C:/Users/jp718/foundry/lib/security/api-keys.ts:3), no call sites found |
| Runtime ops | Health reporting | Operational | [app/api/healthz/route.ts](/C:/Users/jp718/foundry/app/api/healthz/route.ts:5) |
| Runtime ops | Typecheck | Operational | `npm run typecheck` passed |
| Runtime ops | Production build | Operational | `npm run build` passed |
| Runtime ops | Smoke suite | Operational | [scripts/smoke.mjs](/C:/Users/jp718/foundry/scripts/smoke.mjs:23), `npm run smoke` passed |
| Browser automation | Playwright/Puppeteer/CDP/browser-use | Missing | No source implementation found; only lockfile residue for `@playwright/test` |
| Launch workflow | End-to-end launch execution | Missing | Planner output is displayed only: [app/projects/new/page.tsx](/C:/Users/jp718/foundry/app/projects/new/page.tsx:79) |
