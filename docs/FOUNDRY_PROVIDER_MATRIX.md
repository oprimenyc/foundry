# Foundry Provider & Launch-Profile Matrix

Capability metadata is discoverable at runtime via `GET /api/providers`
(`capabilities` field: provider, declared actions, truthful `mock` flag).
Mocks are dev/test only — they fail closed in production.

## Provider matrix

| Capability | Provider | Actions | Real adapter | Credential | Rollback/compensation | Status |
|---|---|---|---|---|---|---|
| repository | github | create_repository, verify_repository | GitHubHttpAdapter (read-back verified) | `GITHUB_TOKEN` | delete created repo (needs delete_repo scope) | Operational offline-proven; live proof credential-blocked |
| repository | local-git | create_repository, verify_repository | dev/test adapter | — | in-memory | Dev/test |
| deployment | vercel | create_project, trigger_deployment, verify_deployment | VercelHttpAdapter (poll-to-READY) | `VERCEL_API_TOKEN` | delete project; cancel deployment | Operational offline-proven; live proof credential-blocked |
| dns | cloudflare | create_dns_record, verify_dns_record | CloudflareDnsAdapter (read-back verified) | `CLOUDFLARE_API_TOKEN` (+ `CLOUDFLARE_ZONE_ID` or per-step zoneId) | delete created record | Operational offline-proven; live proof credential-blocked |
| email | resend | send_email | ResendEmailAdapter | `RESEND_API_KEY` | none — email cannot be unsent (declared) | Operational offline-proven; live proof credential-blocked |
| payments | stripe | create_product, verify_product | StripePaymentsAdapter (read-back verified) | `STRIPE_SECRET_KEY` | archive product (Stripe does not destroy) | Operational offline-proven; live proof credential-blocked |
| telephony | signalwire | send_sms | SignalWireTelephonyAdapter | `SIGNALWIRE_SPACE_URL` + `SIGNALWIRE_PROJECT_ID` + `SIGNALWIRE_API_TOKEN` | none — SMS cannot be recalled (declared) | Operational offline-proven; live proof credential-blocked |
| storage | local-storage | store_artifact, verify_artifact | dev/test only | — | ephemeral | Dev/test; production object store deferred until VERIDIAN artifact requirements land |
| verification | (independent) | HTTP resource checks | lib/foundry/verification.ts | none (stub) / network (live) | n/a — append-only evidence | Operational |

## Launch profiles

Status legend: ✅ operational (offline-proven) · 🔑 credential-blocked live proof only · ⏳ deferred pending real requirement.

### DYLN
| Capability | Operation | Configured provider | Status |
|---|---|---|---|
| repository | create/verify repo | github | ✅/🔑 |
| deployment | project + deploy + verify | vercel | ✅/🔑 |
| dns | CNAME to deployment | cloudflare | ✅/🔑 |
| secrets | encrypted credential refs | built-in KMS | ✅ |
| database | run persistence (single-node) | sqlite | ✅ |
| telephony | launch SMS notification | signalwire | ✅/🔑 |
| payments | product provisioning | stripe | ✅/🔑 |
| email | launch email notification | resend | ✅/🔑 |
| verification | independent deploy check | built-in verifier | ✅ |

### VERIDIAN
| Capability | Operation | Configured provider | Status |
|---|---|---|---|
| repository | create/verify repo | github | ✅/🔑 |
| artifact storage | store/verify artifacts | local-storage | ⏳ production object store deferred — no concrete VERIDIAN artifact contract exists yet |
| deployment | deploy + verify | vercel | ✅/🔑 |
| secrets / database / verification | as DYLN | built-in | ✅ |
| job execution | saga runs with retry/cancel/resume | built-in engine | ✅ |

### AI Chief of Staff
| Capability | Operation | Status |
|---|---|---|
| authenticated service invocation | own principal via `FOUNDRY_PRINCIPALS` (org-scoped token) | ✅ |
| approval-aware execution | plans with `approvalRequired` steps are rejected from automatic execution | ✅ (explicit approval flow not yet built — deferred until CoS defines it) |
| events | org-scoped SSE + durable replay | ✅ |
| cancellation | authorized cancel route | ✅ |
| evidence retrieval | run view + verification API | ✅ |
| notifications | email/SMS steps | ✅/🔑 |

### Rising Promise course production
| Capability | Operation | Status |
|---|---|---|
| source control | github / local-git | ✅/🔑 |
| artifact storage | local-storage | ⏳ as VERIDIAN |
| publication | vercel deployment | ✅/🔑 |
| notification | resend email | ✅/🔑 |
| package verification | independent verifier (HTTP) | ✅ |
