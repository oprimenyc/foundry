import {
  getProviderAdapter,
  listRegisteredProviders,
  mocksExplicitlyAllowed,
  registerProviderAdapter,
  ProviderError,
  type ProviderAdapter,
  type ProviderExecutionInput,
  type ProviderExecutionResult,
} from "@/lib/foundry/providers";
import { universalRegistry } from "./registry";
import { credentialStatusFor } from "./credentials";
import { PROVIDER_VERIFIER_VERSION } from "./verification";
import type {
  ProviderAction,
  ProviderCategory,
  ProviderHealthStatus,
  ProviderManifest,
  ProviderVerificationResult,
  UniversalProvider,
} from "./types";

/**
 * Provider catalog: the ONLY place vendor identities are declared. Everything
 * else in Foundry routes by category + action through the registry and the
 * selection engine.
 *
 * Two kinds of entries:
 *  - Wrapped adapters: existing execution adapters (mock or live, decided by
 *    credential presence at registration in lib/foundry/providers.ts) get a
 *    manifest, health check, and verify() on top.
 *  - Catalog mocks: category coverage for providers with no live client yet.
 *    They label themselves mock, refuse production, and support live
 *    replacement without any core change (register a live adapter + manifest).
 */

interface ManifestSpec {
  id: string;
  name: string;
  category: ProviderCategory;
  actions: ProviderAction[];
  requiredCredentials: string[];
  amountPerAction?: number;
  monthlyFloor?: number;
  estimatedLatencyMs?: number;
  limitations?: string[];
  documentationUrl: string;
  rollbackable?: ProviderAction[];
}

function buildManifest(spec: ManifestSpec, runtimeStatus: ProviderManifest["runtimeStatus"]): ProviderManifest {
  return {
    id: spec.id,
    name: spec.name,
    category: spec.category,
    supportedCapabilities: spec.actions,
    requiredCredentials: spec.requiredCredentials,
    estimatedCost: { currency: "USD", amountPerAction: spec.amountPerAction ?? 0, monthlyFloor: spec.monthlyFloor ?? 0 },
    estimatedLatencyMs: spec.estimatedLatencyMs ?? 500,
    limitations: spec.limitations ?? [],
    documentationUrl: spec.documentationUrl,
    runtimeStatus,
  };
}

function defaultHealthCheck(manifest: ProviderManifest): () => Promise<ProviderHealthStatus> {
  return async () => {
    const started = Date.now();
    const credentials = credentialStatusFor(manifest);
    const healthy = manifest.runtimeStatus === "mock" || credentials.satisfied;
    return {
      providerId: manifest.id,
      healthy,
      detail: healthy
        ? `${manifest.runtimeStatus} provider ready (credential presence check; no network probe)`
        : `missing credentials: ${credentials.missingReferences.join(", ")}`,
      latencyMs: Date.now() - started,
      checkedAt: new Date().toISOString(),
    };
  };
}

function defaultVerify(manifest: ProviderManifest): () => Promise<ProviderVerificationResult> {
  return async () => {
    const credentials = credentialStatusFor(manifest);
    const ok = manifest.runtimeStatus === "mock" || credentials.satisfied;
    return {
      providerId: manifest.id,
      ok,
      detail: ok
        ? `${manifest.id} verified: declares ${manifest.supportedCapabilities.length} action(s), runtime ${manifest.runtimeStatus}`
        : `verification failed: missing credentials ${credentials.missingReferences.join(", ")}`,
      checkedAt: new Date().toISOString(),
      verifierVersion: PROVIDER_VERIFIER_VERSION,
    };
  };
}

/** Wraps an already-registered execution adapter with the universal contract. */
function wrapAdapter(adapter: ProviderAdapter, spec: ManifestSpec): UniversalProvider {
  const live = credentialStatusFor(buildManifest(spec, "live")).satisfied;
  const manifest = buildManifest({ ...spec, actions: adapter.actions }, live ? "live" : "mock");
  return {
    provider: adapter.provider,
    capability: adapter.capability,
    actions: adapter.actions,
    manifest,
    execute: (action, input) => adapter.execute(action, input),
    compensate: adapter.compensate?.bind(adapter),
    healthCheck: defaultHealthCheck(manifest),
    verify: defaultVerify(manifest),
    async rollback(action, input) {
      await adapter.compensate?.(action, input);
    },
  };
}

/** Deterministic catalog mock covering a category with truthful labeling. */
class CatalogMockProvider implements UniversalProvider {
  readonly provider: string;
  readonly capability: ProviderCategory;
  readonly actions: ProviderAction[];
  readonly manifest: ProviderManifest;
  private readonly rollbackable: Set<ProviderAction>;
  private readonly resources = new Map<string, ProviderExecutionResult>();

  readonly healthCheck: () => Promise<ProviderHealthStatus>;
  readonly verify: () => Promise<ProviderVerificationResult>;

  constructor(spec: ManifestSpec) {
    this.provider = spec.id;
    this.capability = spec.category;
    this.actions = spec.actions;
    this.manifest = buildManifest(spec, "mock");
    this.rollbackable = new Set(spec.rollbackable ?? []);
    this.healthCheck = defaultHealthCheck(this.manifest);
    this.verify = defaultVerify(this.manifest);
  }

  private assertMockAllowed() {
    if (process.env.NODE_ENV === "production" && !mocksExplicitlyAllowed()) {
      throw new ProviderError(
        `mock ${this.provider} provider is disabled in production — configure the real provider credential`,
        { category: "validation" }
      );
    }
  }

  async execute(action: ProviderAction, input: ProviderExecutionInput): Promise<ProviderExecutionResult> {
    this.assertMockAllowed();
    if (!this.actions.includes(action)) {
      throw new ProviderError(`Unsupported ${this.provider} action ${action}`, { category: "validation" });
    }
    const key = `${input.runId}:${input.stepId}:${action}`;
    const existing = this.resources.get(key);
    if (existing) return existing;
    const reference = `${this.provider}_${action}_${input.runId}:${input.stepId}`;
    // Action-derived generic references so downstream steps, launch evidence,
    // and independent verification work identically for any provider.
    const references: Record<string, string> = { [`${this.manifest.category}Reference`]: reference };
    if (action === "create_repository") references.repoUrl = `https://repos.mock-${this.provider}.dev/${input.projectId}`;
    if (action === "create_project") references.hostingProjectId = reference;
    if (action === "trigger_deployment") {
      references.deploymentUrl = `https://${input.projectId}.mock-${this.provider}.app`;
      references.deploymentId = `deploy_${input.runId}`;
    }
    const result: ProviderExecutionResult = {
      providerReference: reference,
      output: { mock: true, provider: this.provider, category: this.manifest.category, action, reference, ...references },
      references,
      evidenceReference: `${this.provider}:${reference}`,
    };
    this.resources.set(key, result);
    return result;
  }

  async compensate(action: ProviderAction, input: ProviderExecutionInput & { providerReference?: string }) {
    if (!this.rollbackable.has(action)) return;
    this.resources.delete(`${input.runId}:${input.stepId}:${action}`);
  }

  async rollback(action: ProviderAction, input: ProviderExecutionInput & { providerReference?: string }) {
    await this.compensate(action, input);
  }
}

function registerCatalogMock(spec: ManifestSpec) {
  if (universalRegistry.has(spec.id)) return;
  const provider = new CatalogMockProvider(spec);
  universalRegistry.register(provider);
  if (!listRegisteredProviders().includes(spec.id)) registerProviderAdapter(provider);
}

function registerWrapped(providerId: string, spec: Omit<ManifestSpec, "id" | "actions">) {
  if (universalRegistry.has(providerId)) return;
  const adapter = getProviderAdapter(providerId);
  universalRegistry.register(wrapAdapter(adapter, { ...spec, id: providerId, actions: adapter.actions }));
}

// ---------------------------------------------------------------------------
// Wrapped execution adapters (registered by lib/foundry/providers.ts).
// ---------------------------------------------------------------------------

registerWrapped("github", {
  name: "GitHub",
  category: "repository",
  requiredCredentials: ["GITHUB_TOKEN"],
  estimatedLatencyMs: 800,
  limitations: ["repository creation rate limits apply"],
  documentationUrl: "https://docs.github.com/en/rest",
});
registerWrapped("local-git", {
  name: "Local Git",
  category: "repository",
  requiredCredentials: [],
  estimatedLatencyMs: 50,
  limitations: ["local filesystem only; no remote collaboration"],
  documentationUrl: "https://git-scm.com/docs",
});
registerWrapped("vercel", {
  name: "Vercel",
  category: "hosting",
  requiredCredentials: ["VERCEL_API_TOKEN"],
  amountPerAction: 0.01,
  monthlyFloor: 20,
  estimatedLatencyMs: 5000,
  limitations: ["serverless-first; long-running processes unsupported"],
  documentationUrl: "https://vercel.com/docs/rest-api",
});
registerWrapped("cloudflare", {
  name: "Cloudflare",
  category: "dns",
  requiredCredentials: ["CLOUDFLARE_API_TOKEN"],
  estimatedLatencyMs: 600,
  limitations: ["zone must already exist"],
  documentationUrl: "https://developers.cloudflare.com/api/",
});
registerWrapped("resend", {
  name: "Resend",
  category: "email",
  requiredCredentials: ["RESEND_API_KEY"],
  amountPerAction: 0.001,
  estimatedLatencyMs: 700,
  limitations: ["sent email cannot be recalled — no rollback"],
  documentationUrl: "https://resend.com/docs/api-reference",
});
registerWrapped("stripe", {
  name: "Stripe",
  category: "payments",
  requiredCredentials: ["STRIPE_SECRET_KEY"],
  amountPerAction: 0.0,
  estimatedLatencyMs: 900,
  limitations: ["products are archived on rollback, not destroyed"],
  documentationUrl: "https://docs.stripe.com/api",
});
registerWrapped("signalwire", {
  name: "SignalWire",
  category: "sms",
  requiredCredentials: ["SIGNALWIRE_SPACE_URL", "SIGNALWIRE_PROJECT_ID", "SIGNALWIRE_API_TOKEN"],
  amountPerAction: 0.008,
  estimatedLatencyMs: 1200,
  limitations: ["sent SMS cannot be recalled — no rollback"],
  documentationUrl: "https://developer.signalwire.com/",
});
registerWrapped("local-storage", {
  name: "Local Storage",
  category: "storage",
  requiredCredentials: [],
  estimatedLatencyMs: 20,
  limitations: ["test/dev artifact store; not production object storage"],
  documentationUrl: "https://nodejs.org/api/fs.html",
});

// ---------------------------------------------------------------------------
// Catalog mocks: category coverage. Mock adapters are acceptable (mission stop
// condition); the architecture supports live adapters without redesign — a
// live adapter registers with the same id and manifest, nothing else changes.
// ---------------------------------------------------------------------------

const CATALOG_MOCKS: ManifestSpec[] = [
  // hosting alternatives — the planner never prefers one; selection decides.
  { id: "railway", name: "Railway", category: "hosting", actions: ["create_project", "trigger_deployment", "verify_deployment"], rollbackable: ["create_project"], requiredCredentials: ["RAILWAY_API_TOKEN"], amountPerAction: 0.01, monthlyFloor: 5, estimatedLatencyMs: 6000, limitations: ["usage-based billing"], documentationUrl: "https://docs.railway.com/reference/public-api" },
  { id: "fly-io", name: "Fly.io", category: "hosting", actions: ["create_project", "trigger_deployment", "verify_deployment"], rollbackable: ["create_project"], requiredCredentials: ["FLY_API_TOKEN"], amountPerAction: 0.01, monthlyFloor: 5, estimatedLatencyMs: 7000, limitations: ["machine-based; region capacity varies"], documentationUrl: "https://fly.io/docs/machines/api/" },
  { id: "netlify", name: "Netlify", category: "hosting", actions: ["create_project", "trigger_deployment", "verify_deployment"], rollbackable: ["create_project"], requiredCredentials: ["NETLIFY_AUTH_TOKEN"], amountPerAction: 0.01, monthlyFloor: 19, estimatedLatencyMs: 6000, limitations: ["static/functions focus"], documentationUrl: "https://docs.netlify.com/api/get-started/" },
  { id: "gitlab", name: "GitLab", category: "repository", actions: ["create_repository", "verify_repository"], rollbackable: ["create_repository"], requiredCredentials: ["GITLAB_TOKEN"], estimatedLatencyMs: 900, limitations: [], documentationUrl: "https://docs.gitlab.com/ee/api/" },
  { id: "route53", name: "AWS Route 53", category: "dns", actions: ["create_dns_record", "verify_dns_record", "issue_certificate", "verify_certificate"], rollbackable: ["create_dns_record"], requiredCredentials: ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"], amountPerAction: 0.0005, monthlyFloor: 0.5, estimatedLatencyMs: 1500, limitations: ["hosted zone charges apply"], documentationUrl: "https://docs.aws.amazon.com/Route53/latest/APIReference/" },
  { id: "postmark", name: "Postmark", category: "email", actions: ["send_email", "configure_email_domain", "configure_catch_all"], requiredCredentials: ["POSTMARK_SERVER_TOKEN"], amountPerAction: 0.00125, estimatedLatencyMs: 800, limitations: ["transactional email focus"], documentationUrl: "https://postmarkapp.com/developer" },
  { id: "twilio", name: "Twilio", category: "sms", actions: ["send_sms"], requiredCredentials: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"], amountPerAction: 0.0079, estimatedLatencyMs: 1200, limitations: ["sent SMS cannot be recalled"], documentationUrl: "https://www.twilio.com/docs/sms" },
  { id: "signalwire-voice", name: "SignalWire Voice", category: "voice", actions: ["place_call", "verify_call"], requiredCredentials: ["SIGNALWIRE_SPACE_URL", "SIGNALWIRE_PROJECT_ID", "SIGNALWIRE_API_TOKEN"], amountPerAction: 0.01, estimatedLatencyMs: 2000, limitations: ["calls cannot be un-placed"], documentationUrl: "https://developer.signalwire.com/compatibility-api/rest/" },
  { id: "telnyx", name: "Telnyx", category: "voice", actions: ["place_call", "verify_call"], requiredCredentials: ["TELNYX_API_KEY"], amountPerAction: 0.009, estimatedLatencyMs: 2000, limitations: [], documentationUrl: "https://developers.telnyx.com/" },
  { id: "supabase", name: "Supabase", category: "database", actions: ["provision_database", "verify_database"], rollbackable: ["provision_database"], requiredCredentials: ["SUPABASE_ACCESS_TOKEN"], monthlyFloor: 25, estimatedLatencyMs: 8000, limitations: ["Postgres only"], documentationUrl: "https://supabase.com/docs/reference/api" },
  { id: "neon", name: "Neon", category: "database", actions: ["provision_database", "verify_database"], rollbackable: ["provision_database"], requiredCredentials: ["NEON_API_KEY"], monthlyFloor: 19, estimatedLatencyMs: 5000, limitations: ["Postgres only; branch limits per plan"], documentationUrl: "https://api-docs.neon.tech/" },
  { id: "square", name: "Square", category: "payments", actions: ["create_product", "verify_product"], rollbackable: ["create_product"], requiredCredentials: ["SQUARE_ACCESS_TOKEN"], estimatedLatencyMs: 1000, limitations: [], documentationUrl: "https://developer.squareup.com/reference/square" },
  { id: "google-identity", name: "Google Identity", category: "identity", actions: ["configure_oauth_client", "verify_oauth_client"], rollbackable: ["configure_oauth_client"], requiredCredentials: ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET"], estimatedLatencyMs: 1500, limitations: ["consent screen review for sensitive scopes"], documentationUrl: "https://developers.google.com/identity" },
  { id: "s3", name: "AWS S3", category: "storage", actions: ["store_artifact", "verify_artifact"], rollbackable: ["store_artifact"], requiredCredentials: ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"], amountPerAction: 0.000005, estimatedLatencyMs: 400, limitations: [], documentationUrl: "https://docs.aws.amazon.com/s3/" },
  { id: "google-analytics", name: "Google Analytics", category: "analytics", actions: ["configure_analytics", "verify_analytics"], rollbackable: ["configure_analytics"], requiredCredentials: ["GOOGLE_ANALYTICS_CREDENTIALS"], estimatedLatencyMs: 2000, limitations: ["data latency 24-48h"], documentationUrl: "https://developers.google.com/analytics" },
  { id: "google-tag-manager", name: "Google Tag Manager", category: "analytics", actions: ["configure_tag_container", "verify_tag_container"], rollbackable: ["configure_tag_container"], requiredCredentials: ["GOOGLE_TAG_MANAGER_CREDENTIALS"], estimatedLatencyMs: 2000, limitations: [], documentationUrl: "https://developers.google.com/tag-platform/tag-manager/api/v2" },
  { id: "uptime-monitor", name: "Uptime Monitor", category: "monitoring", actions: ["configure_monitor", "configure_alert", "verify_monitor"], rollbackable: ["configure_monitor", "configure_alert"], requiredCredentials: ["UPTIME_MONITOR_API_KEY"], estimatedLatencyMs: 800, limitations: [], documentationUrl: "https://uptimerobot.com/api/" },
  { id: "playwright", name: "Playwright", category: "browser_automation", actions: ["run_browser_task", "verify_browser_task"], requiredCredentials: [], estimatedLatencyMs: 10000, limitations: ["local browser runtime required"], documentationUrl: "https://playwright.dev/docs/intro" },
  { id: "anthropic", name: "Anthropic Claude", category: "llm", actions: ["generate_completion"], requiredCredentials: ["ANTHROPIC_API_KEY"], amountPerAction: 0.02, estimatedLatencyMs: 3000, limitations: ["token limits per model"], documentationUrl: "https://docs.anthropic.com/" },
  { id: "google-search-console", name: "Google Search Console", category: "search_console", actions: ["submit_sitemap", "verify_site_ownership"], requiredCredentials: ["GOOGLE_SEARCH_CONSOLE_CREDENTIALS"], estimatedLatencyMs: 2500, limitations: ["indexing is asynchronous"], documentationUrl: "https://developers.google.com/webmaster-tools" },
  { id: "bing-webmaster", name: "Bing Webmaster", category: "search_console", actions: ["submit_sitemap", "verify_site_ownership"], requiredCredentials: ["BING_WEBMASTER_API_KEY"], estimatedLatencyMs: 2500, limitations: [], documentationUrl: "https://learn.microsoft.com/en-us/bingwebmaster/" },
  { id: "google-business-profile", name: "Google Business Profile", category: "business_listing", actions: ["create_listing", "verify_listing"], requiredCredentials: ["GOOGLE_BUSINESS_PROFILE_CREDENTIALS"], estimatedLatencyMs: 3000, limitations: ["listing verification is human-gated by Google"], documentationUrl: "https://developers.google.com/my-business" },
  { id: "google-maps", name: "Google Maps Platform", category: "maps", actions: ["configure_maps_key", "verify_maps_key"], rollbackable: ["configure_maps_key"], requiredCredentials: ["GOOGLE_MAPS_API_KEY"], amountPerAction: 0.005, estimatedLatencyMs: 900, limitations: ["billing account required"], documentationUrl: "https://developers.google.com/maps" },
  { id: "google-calendar", name: "Google Calendar", category: "calendar", actions: ["create_calendar", "create_event", "verify_calendar"], rollbackable: ["create_calendar", "create_event"], requiredCredentials: ["GOOGLE_CALENDAR_CREDENTIALS"], estimatedLatencyMs: 1200, limitations: [], documentationUrl: "https://developers.google.com/calendar" },
  { id: "hubspot", name: "HubSpot", category: "crm", actions: ["create_crm_contact", "verify_crm_contact"], rollbackable: ["create_crm_contact"], requiredCredentials: ["HUBSPOT_ACCESS_TOKEN"], monthlyFloor: 20, estimatedLatencyMs: 1500, limitations: [], documentationUrl: "https://developers.hubspot.com/docs/api/overview" },
  { id: "typeform", name: "Typeform", category: "forms", actions: ["create_form", "verify_form"], rollbackable: ["create_form"], requiredCredentials: ["TYPEFORM_TOKEN"], monthlyFloor: 25, estimatedLatencyMs: 1200, limitations: [], documentationUrl: "https://www.typeform.com/developers/" },
];

for (const spec of CATALOG_MOCKS) registerCatalogMock(spec);

export { universalRegistry };
