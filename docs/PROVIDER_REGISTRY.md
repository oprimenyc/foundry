# PROVIDER_REGISTRY.md

**Foundry Universal Provider Registry — M2**
**Status:** Operational (runtime-proven: `npm run proof:m2`, `tests/universal.test.ts`)

---

## What it is

One registry per capability category plus a flat provider-id index
(`lib/foundry/universal/registry.ts`). Foundry core never asks for a vendor by
name — it asks *"who can do `<action>` in `<category>`?"* and the Selection
Engine picks among the answers.

The execution-path registries in `lib/foundry/providers.ts` are keyed by the
same categories; legacy capability ids (`deployment` → `hosting`,
`telephony` → `sms`) normalize at every boundary.

## Categories (20)

hosting, repository, dns, email, sms, voice, database, payments, identity,
storage, analytics, monitoring, browser_automation, llm, search_console,
business_listing, maps, calendar, crm, forms

Every category has at least one registered provider (test-enforced:
`universal registry covers every category`).

## Registered providers (34 at M2)

Declared in exactly one place: `lib/foundry/universal/catalog.ts`.

| Kind | Providers |
|---|---|
| Wrapped execution adapters (mock/live by credential presence) | github, local-git, vercel, cloudflare, resend, stripe, signalwire, local-storage |
| Catalog mocks (live-replaceable, production-locked) | railway, fly-io, netlify, gitlab, route53, postmark, twilio, signalwire-voice, telnyx, supabase, neon, square, google-identity, s3, google-analytics, google-tag-manager, uptime-monitor, playwright, anthropic, google-search-console, bing-webmaster, google-business-profile, google-maps, google-calendar, hubspot, typeform |

## Rules

- Duplicate registration throws (`DuplicateProviderError`); unknown lookup throws (`UnknownProviderError`). Fail closed.
- Adding a provider = register an adapter + manifest in the catalog. Zero changes to execution, planning, or verification code (test-enforced: `core execution modules contain no vendor-name branching`).
- A live adapter replaces a catalog mock by registering with the same id — no redesign.
- Registry contents are queryable at `GET /api/providers` (manifests, capability matrix, health scores; credential *names* only).
