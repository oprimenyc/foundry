# Foundry — Replit Deployment Classification: Current Truth

## Repo / branch / HEAD

- **Repo path:** `C:\Users\jp718\foundry`
- **Branch:** `mission/m3-vault-intelligence`
- **Starting HEAD:** `b5c0c72b74897687007b1330775d33c6a71de046` (tip of the provider action adapter mega run, already committed)
- **Working tree at start:** clean.

## The classification rule

```text
REPLIT_CLASSIFICATION:
- Replit may appear only as historical/dev workspace provenance.
- Replit must not be recommended as production/staging hosting.
- Replit must not be emitted as a provider action target.
- Replit-origin projects must be migrated to approved deployment targets before launch.
- Approved deployment targets must be separately selected and proven.
```

## What was searched

`Replit`/`replit` (case-insensitive) across `lib/provider-actions/`, `FOUNDRY_PROVIDER_ADAPTER_MEGA*.md`, and `tests/provider-actions.test.ts`.

## What was found

Exactly two files carried Replit-as-deployment-target framing — both introduced by the immediately-prior provider action adapter mission, in this same session:

1. **`lib/provider-actions/fixtures/primeopp-domain-env-deployment-advisory.fixture.json`** — its `sourceReference` stated "deployment target is Replit's own autoscale (no Vercel/Railway/Fly/Cloudflare config found in the repo)." This is a factually accurate description of PrimeOpp's *current* host (confirmed independently in `PRIMEOPP_DOMAIN_READINESS.md`), but carried no explicit disclaimer that this is provenance, not a recommendation — exactly the ambiguity this mission's classification rule exists to close.
2. **`FOUNDRY_PROVIDER_ADAPTER_MEGA_IMPLEMENTATION_REPORT.md`** — one paragraph described PrimeOpp's Replit host in the same under-qualified way.

No other file in Foundry mentions Replit. `lib/provider-actions/types.ts`'s `PROVIDER_TYPES` enum (`github`, `database`, `google_oauth`, `nextauth`, `railway`, `fly`, `vercel`, `generic_env`) never included, and will never include, `"replit"` — the contract was already correct at the type level; only the fixture's *prose* needed the explicit correction.

## Unrelated dirty files preserved

None existed — the tree was clean at start.

## Remaining work for this mission

See `FOUNDRY_REPLIT_CLASSIFICATION_PROOF.md` for what was actually changed and verified.
