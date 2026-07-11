# PROVIDER_COST_MODEL.md

**Foundry Provider Cost Engine — M2**
**Source:** `lib/foundry/universal/cost.ts`

---

## Model

Each manifest declares `estimatedCost`:

- `amountPerAction` (USD) — marginal cost per executed action.
- `monthlyFloor` (USD) — fixed subscription/reserved floor.

Comparable scalar: `amountPerAction + monthlyFloor / 10000` — per-action cost
dominates; the floor tie-breaks between otherwise equal providers.

## Rules

- Costs are DECLARED ESTIMATES for ranking only — never billing truth.
- The cost engine never blocks a run on its own; the tenant policy cap does:
  `maxMonthlyCostUsd` rejects providers whose `monthlyFloor` exceeds the cap,
  with the rejection reason recorded in the selection decision.
- `rankByCost(manifests)` is deterministic (id tie-break).

## Position in selection ranking

preferred → health → **cost** → latency → id.

Runtime-proven: `tests/universal.test.ts` — "cost engine ranks cheapest-first…"
(railway beats netlify at equal health; netlify rejected under a $10 cap).
