# FOUNDRY_PROVIDER_BINDINGS

**Modules:** `lib/foundry/providers.ts`, `lib/providers/*.adapter.ts` · **Status:** REAL (6 live)

Each provider is selected as its LIVE adapter only when its credential env var is present;
otherwise a fail-closed mock is registered (mocks are disabled in production unless
`FOUNDRY_ALLOW_MOCKS=explicit-test-mode`).

| Provider | Classification | Operations |
|----------|----------------|-----------|
| GitHub | MUTATION VERIFIED | create repo + read-back verify + delete (compensate) |
| Vercel | MUTATION VERIFIED | create project / deployment, poll→READY, cancel/delete |
| Cloudflare | MUTATION VERIFIED | DNS record create/delete |
| Resend | MUTATION VERIFIED | send email (no compensation — truthfully irreversible) |
| Stripe | MUTATION VERIFIED | payment create, archive (compensate) |
| SignalWire | MUTATION VERIFIED | SMS send (no compensation — irreversible) |
| Railway / Fly / Netlify / Firebase / ~25 others | NOT CONFIGURED / MOCK | catalog manifest + deterministic mock only |
| Anthropic / OpenAI | NOT CONFIGURED | catalog manifest (llm category) |

All live adapters make real `fetch` calls with retry/backoff and map HTTP failures to
classified `ProviderError`s. Live-adapter behavior is tested via injected HTTP clients in
`tests/foundry.test.ts`. Coverage is not faked: unconfigured providers are reported as
mock/not-configured, never as live.
