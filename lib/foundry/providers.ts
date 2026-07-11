import { randomUUID } from "crypto";
import type { ProviderAction } from "./types";
import { ProviderRegistry } from "./registry";
import { PROVIDER_CATEGORIES, normalizeCategory, type ProviderCategory } from "./universal/types";
import { VercelAdapter as VercelHttpClient } from "@/lib/providers/vercel.adapter";
import { GitHubAdapter as GitHubHttpClient } from "@/lib/providers/github.adapter";
import { ProviderError as HttpProviderError } from "@/lib/providers/http-client";
import {
  CloudflareAdapter as CloudflareHttpClient,
  ResendAdapter as ResendHttpClient,
  SignalWireAdapter as SignalWireHttpClient,
  StripeAdapter as StripeHttpClient,
} from "@/lib/providers/domains.adapter";

export interface ProviderExecutionInput {
  runId: string;
  stepId: string;
  projectId: string;
  config: Record<string, string | number | boolean | null | undefined>;
  providerReferences: Record<string, string>;
}

export interface ProviderExecutionResult {
  providerReference: string;
  output: Record<string, unknown>;
  /**
   * Generic, provider-agnostic references (repoUrl, deploymentUrl, …) that the
   * execution engine merges into the run's providerReferences. Adapters own
   * the mapping; the engine never branches on a provider name.
   */
  references?: Record<string, string>;
  evidenceReference?: string;
}

export interface ProviderCompensationInput extends ProviderExecutionInput {
  providerReference?: string;
}

// Capability is now the universal category set plus legacy aliases
// ("deployment" → hosting, "telephony" → sms) kept for pre-M2 adapters/plans.
export type ProviderCapability = ProviderCategory | "deployment" | "telephony";

export interface ProviderAdapter {
  provider: string;
  capability: ProviderCapability;
  actions: ProviderAction[];
  execute(action: ProviderAction, input: ProviderExecutionInput): Promise<ProviderExecutionResult>;
  compensate?(action: ProviderAction, input: ProviderCompensationInput): Promise<void>;
}

/**
 * Normalized provider failure. Adapters may throw this to control retry
 * behavior; unclassified errors are treated as non-retryable provider
 * failures by the execution policy.
 */
export class ProviderError extends Error {
  readonly retryable: boolean;
  readonly category: "provider" | "timeout" | "validation";

  constructor(message: string, options: { retryable?: boolean; category?: "provider" | "timeout" | "validation" } = {}) {
    super(message);
    this.name = "ProviderError";
    this.retryable = options.retryable ?? false;
    this.category = options.category ?? "provider";
  }
}

/**
 * Mocks never masquerade as live providers in production: they are only
 * selected when the real credential is absent, and in production that
 * combination fails closed instead of fabricating provider results.
 */
export function mocksExplicitlyAllowed(): boolean {
  // Loud, deliberate opt-in for test harnesses running production builds
  // (e.g. crash-recovery proof under `next start`). Reported by /api/healthz —
  // it can never be a silent fallback.
  return process.env.FOUNDRY_ALLOW_MOCKS === "explicit-test-mode";
}

function assertMockAllowed(provider: string) {
  if (process.env.NODE_ENV === "production" && !mocksExplicitlyAllowed()) {
    throw new ProviderError(
      `mock ${provider} provider is disabled in production — configure the real provider credential`,
      { category: "validation" }
    );
  }
}

/** Maps HTTP-layer failures to classified Foundry provider errors. */
function normalizeHttpError(provider: string, error: unknown): never {
  if (error instanceof HttpProviderError) {
    const retryable = error.statusCode === 429 || error.statusCode >= 500;
    throw new ProviderError(`${provider} API error (${error.statusCode}): ${error.message}`, {
      retryable,
      category: "provider",
    });
  }
  throw error;
}

class MockGitHubAdapter implements ProviderAdapter {
  provider = "github";
  capability = "repository" as const;
  actions: ProviderAction[] = ["create_repository", "verify_repository"];
  private repos = new Map<string, ProviderExecutionResult>();

  async execute(action: ProviderAction, input: ProviderExecutionInput): Promise<ProviderExecutionResult> {
    assertMockAllowed("github");
    if (action === "create_repository") {
      const key = `${input.runId}:${input.stepId}`;
      const existing = this.repos.get(key);
      if (existing) return existing;
      const repoName = String(input.config.repositoryName || input.config.projectName || "foundry-app");
      const repoUrl = `https://github.com/mock-org/${repoName}`;
      const result = {
        providerReference: `gh_repo_${randomUUID()}`,
        output: {
          repoUrl,
          repositoryId: key,
          defaultBranch: "main",
        },
        references: { repoUrl },
        evidenceReference: `github:${repoName}`,
      };
      this.repos.set(key, result);
      return result;
    }

    if (action === "verify_repository") {
      const repoUrl = String(input.providerReferences.repoUrl || input.providerReferences.githubRepoUrl || "");
      if (!repoUrl) throw new Error("repository not found for verification");
      return {
        providerReference: `gh_verify_${randomUUID()}`,
        output: { repoUrl, verified: true },
        evidenceReference: repoUrl,
      };
    }

    throw new Error(`Unsupported GitHub action ${action}`);
  }

  async compensate(action: ProviderAction, input: ProviderCompensationInput) {
    if (action === "create_repository") {
      this.repos.delete(`${input.runId}:${input.stepId}`);
    }
  }
}

/**
 * Second repository provider, registered purely additively to prove the registry
 * pattern: nothing in execution.ts, plan.ts, or types.ts had to change for this
 * provider to exist and be selectable.
 */
class LocalGitAdapter implements ProviderAdapter {
  provider = "local-git";
  capability = "repository" as const;
  actions: ProviderAction[] = ["create_repository", "verify_repository"];
  private repos = new Map<string, ProviderExecutionResult>();

  async execute(action: ProviderAction, input: ProviderExecutionInput): Promise<ProviderExecutionResult> {
    if (action === "create_repository") {
      const key = `${input.runId}:${input.stepId}`;
      const existing = this.repos.get(key);
      if (existing) return existing;
      const repoName = String(input.config.repositoryName || input.config.projectName || "foundry-app");
      const repoUrl = `file:///var/foundry/repos/${repoName}.git`;
      const result = {
        providerReference: `local_repo_${randomUUID()}`,
        output: { repoUrl, repositoryId: key, defaultBranch: "main" },
        references: { repoUrl },
        evidenceReference: `local-git:${repoName}`,
      };
      this.repos.set(key, result);
      return result;
    }
    if (action === "verify_repository") {
      const repoUrl = String(input.providerReferences.repoUrl || input.providerReferences.githubRepoUrl || "");
      if (!repoUrl) throw new Error("repository not found for verification");
      return { providerReference: `local_verify_${randomUUID()}`, output: { repoUrl, verified: true }, evidenceReference: repoUrl };
    }
    throw new Error(`Unsupported local-git action ${action}`);
  }

  async compensate(action: ProviderAction, input: ProviderCompensationInput) {
    if (action === "create_repository") this.repos.delete(`${input.runId}:${input.stepId}`);
  }
}

class MockVercelAdapter implements ProviderAdapter {
  provider = "vercel";
  capability = "deployment" as const;
  actions: ProviderAction[] = ["create_project", "trigger_deployment", "verify_deployment"];
  private projects = new Map<string, ProviderExecutionResult>();

  async execute(action: ProviderAction, input: ProviderExecutionInput): Promise<ProviderExecutionResult> {
    assertMockAllowed("vercel");
    const key = `${input.runId}:${input.stepId}`;
    if (action === "create_project") {
      const existing = this.projects.get(key);
      if (existing) return existing;
      const projectName = String(input.config.projectName || input.config.repositoryName || "foundry-app");
      const repoUrl = String(input.providerReferences.repoUrl || input.providerReferences.githubRepoUrl || "");
      if (!repoUrl) throw new Error("missing repository URL");
      const result = {
        providerReference: `vercel_project_${randomUUID()}`,
        output: { projectId: key, projectName, repoUrl },
        references: { hostingProjectId: key },
        evidenceReference: `vercel:${projectName}`,
      };
      this.projects.set(key, result);
      return result;
    }

    if (action === "trigger_deployment") {
      const projectId = String(input.providerReferences.hostingProjectId || input.providerReferences.vercelProjectId || "");
      if (!projectId) throw new Error("missing hosting project");
      const deploymentUrl = `https://${input.projectId}.mock-vercel.app`;
      return {
        providerReference: `vercel_deploy_${randomUUID()}`,
        output: {
          deploymentId: `deploy_${input.runId}`,
          deploymentUrl,
          state: "READY",
        },
        references: { deploymentUrl, deploymentId: `deploy_${input.runId}` },
        evidenceReference: deploymentUrl,
      };
    }

    if (action === "verify_deployment") {
      const deploymentUrl = String(input.providerReferences.deploymentUrl || input.providerReferences.vercelDeploymentUrl || "");
      if (!deploymentUrl) throw new Error("deployment URL missing");
      return {
        providerReference: `vercel_verify_${randomUUID()}`,
        output: { deploymentUrl, reachable: true, status: 200 },
        evidenceReference: deploymentUrl,
      };
    }

    throw new Error(`Unsupported Vercel action ${action}`);
  }

  async compensate(action: ProviderAction, input: ProviderCompensationInput) {
    if (action === "create_project") {
      this.projects.delete(`${input.runId}:${input.stepId}`);
    }
  }
}

/**
 * Real GitHub adapter behind the same registry contract as the mock. Only
 * selected when GITHUB_TOKEN is configured. Success is never reported from
 * the create call alone: the resulting repository is read back first.
 */
export class GitHubHttpAdapter implements ProviderAdapter {
  provider = "github";
  capability = "repository" as const;
  actions: ProviderAction[] = ["create_repository", "verify_repository"];
  private client: GitHubHttpClient;

  constructor(apiToken: string, client?: GitHubHttpClient) {
    this.client = client ?? new GitHubHttpClient(apiToken);
  }

  async execute(action: ProviderAction, input: ProviderExecutionInput): Promise<ProviderExecutionResult> {
    try {
      if (action === "create_repository") {
        const name = String(input.config.repositoryName || input.config.projectName || "");
        if (!name) throw new ProviderError("missing repositoryName", { category: "validation" });
        const org = input.config.repositoryOwner ? String(input.config.repositoryOwner) : undefined;
        const created = await this.client.createRepository({ name, org });
        const [owner, repo] = created.full_name.split("/");
        // Independent read-back: the repository must actually exist and be reachable.
        const verified = await this.client.getRepository(owner, repo);
        return {
          providerReference: verified.full_name,
          output: {
            repoUrl: verified.html_url,
            repositoryId: String(verified.id),
            defaultBranch: verified.default_branch,
            private: verified.private,
          },
          references: { repoUrl: verified.html_url },
          evidenceReference: `github:${verified.full_name}#${verified.id}`,
        };
      }
      if (action === "verify_repository") {
        const fromUrl = String(input.providerReferences.repoUrl || input.providerReferences.githubRepoUrl || "").replace(/^https:\/\/github\.com\//, "");
        const fullName = String(input.config.repositoryFullName || fromUrl || "");
        const [owner, repo] = fullName.split("/");
        if (!owner || !repo) throw new ProviderError("missing repository reference to verify", { category: "validation" });
        const found = await this.client.getRepository(owner, repo);
        return {
          providerReference: found.full_name,
          output: { repoUrl: found.html_url, repositoryId: String(found.id), defaultBranch: found.default_branch, verified: true },
          evidenceReference: `github:${found.full_name}#${found.id}`,
        };
      }
      throw new ProviderError(`Unsupported GitHub action ${action}`, { category: "validation" });
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      normalizeHttpError("github", error);
    }
  }

  async compensate(action: ProviderAction, input: ProviderCompensationInput) {
    // Compensation deletes only the repository this run created (full_name is
    // the providerReference recorded by create_repository).
    if (action === "create_repository" && input.providerReference) {
      const [owner, repo] = input.providerReference.split("/");
      if (!owner || !repo) throw new ProviderError(`invalid repository reference "${input.providerReference}"`, { category: "validation" });
      try {
        await this.client.deleteRepository(owner, repo);
      } catch (error) {
        normalizeHttpError("github", error);
      }
    }
  }
}

/**
 * Real Vercel adapter: wires the previously-orphaned HTTP client
 * (lib/providers/vercel.adapter.ts) into the execution path behind the same
 * ProviderAdapter contract as the mock. Only selected when a real token is
 * configured, so existing mock-backed tests/mock-e2e are unaffected.
 */
export class VercelHttpAdapter implements ProviderAdapter {
  provider = "vercel";
  capability = "deployment" as const;
  actions: ProviderAction[] = ["create_project", "trigger_deployment", "verify_deployment"];
  private client: VercelHttpClient;

  constructor(apiToken: string, client?: VercelHttpClient) {
    this.client = client ?? new VercelHttpClient(apiToken);
  }

  async execute(action: ProviderAction, input: ProviderExecutionInput): Promise<ProviderExecutionResult> {
    if (action === "create_project") {
      const projectName = String(input.config.projectName || input.config.repositoryName || "foundry-app");
      const repoUrl = String(input.providerReferences.repoUrl || input.providerReferences.githubRepoUrl || "");
      if (!repoUrl) throw new Error("missing repository URL");
      const created = await this.client.createProject({ name: projectName, repoUrl });
      return {
        providerReference: created.id,
        output: { projectId: created.id, projectName: created.name, repoUrl },
        references: { hostingProjectId: created.id, hostingProjectName: created.name },
        evidenceReference: `vercel:${created.name}`,
      };
    }
    if (action === "trigger_deployment") {
      const projectName = String(input.config.projectName || input.providerReferences.hostingProjectName || input.providerReferences.vercelProjectName || "foundry-app");
      const repoUrl = String(input.providerReferences.repoUrl || input.providerReferences.githubRepoUrl || "");
      if (!repoUrl) throw new ProviderError("missing repository URL for deployment", { category: "validation" });
      const deployment = await this.client.createDeployment({
        projectName,
        repoUrl,
        ref: input.config.gitRef ? String(input.config.gitRef) : undefined,
      });
      const deploymentUrl = deployment.url.startsWith("http") ? deployment.url : `https://${deployment.url}`;
      return {
        providerReference: deployment.id,
        output: {
          deploymentId: deployment.id,
          deploymentUrl,
          readyState: deployment.readyState,
        },
        references: { deploymentUrl, deploymentId: deployment.id },
        evidenceReference: `vercel:deployment:${deployment.id}`,
      };
    }
    if (action === "verify_deployment") {
      const deploymentId = String(input.config.deploymentId || input.providerReferences.deploymentId || input.providerReferences.vercelDeploymentId || "");
      if (!deploymentId) throw new ProviderError("missing deployment id to verify", { category: "validation" });
      // Step timeout (execution policy) bounds this poll loop.
      const deployment = await this.client.waitForDeployment(deploymentId);
      return {
        providerReference: deployment.id,
        output: {
          deploymentId: deployment.id,
          deploymentUrl: deployment.url.startsWith("http") ? deployment.url : `https://${deployment.url}`,
          readyState: deployment.readyState,
        },
        evidenceReference: `vercel:deployment:${deployment.id}:READY`,
      };
    }
    throw new ProviderError(`Unsupported Vercel action ${action}`, { category: "validation" });
  }

  async compensate(action: ProviderAction, input: ProviderCompensationInput) {
    if (action === "create_project" && input.providerReference) {
      await this.client.deleteProject(input.providerReference);
    }
    if (action === "trigger_deployment" && input.providerReference) {
      await this.client.cancelDeployment(input.providerReference);
    }
  }
}

/**
 * Deterministic mock for any domain: labels itself, refuses production, and
 * fabricates stable references for dev/test plans.
 */
class MockDomainAdapter implements ProviderAdapter {
  constructor(
    readonly provider: string,
    readonly capability: ProviderCapability,
    readonly actions: ProviderAction[],
    private readonly rollbackable: ProviderAction[] = []
  ) {}

  async execute(action: ProviderAction, input: ProviderExecutionInput): Promise<ProviderExecutionResult> {
    assertMockAllowed(this.provider);
    if (!this.actions.includes(action)) {
      throw new ProviderError(`Unsupported ${this.provider} action ${action}`, { category: "validation" });
    }
    const reference = `${this.provider}_${action}_${input.runId}:${input.stepId}`;
    return {
      providerReference: reference,
      output: { mock: true, provider: this.provider, action, reference },
      references: { [`${this.capability}Reference`]: reference },
      evidenceReference: `${this.provider}:${reference}`,
    };
  }

  async compensate(action: ProviderAction) {
    if (!this.rollbackable.includes(action)) return;
    // Mock resources are ephemeral; nothing to delete.
  }
}

/** Real Cloudflare DNS adapter (create/verify/delete records in a zone). */
export class CloudflareDnsAdapter implements ProviderAdapter {
  provider = "cloudflare";
  capability = "dns" as const;
  actions: ProviderAction[] = ["create_dns_record", "verify_dns_record"];
  private client: CloudflareHttpClient;

  constructor(apiToken: string, client?: CloudflareHttpClient) {
    this.client = client ?? new CloudflareHttpClient(apiToken);
  }

  async execute(action: ProviderAction, input: ProviderExecutionInput): Promise<ProviderExecutionResult> {
    try {
      if (action === "create_dns_record") {
        const zoneId = String(input.config.zoneId || process.env.CLOUDFLARE_ZONE_ID || "");
        if (!zoneId) throw new ProviderError("missing Cloudflare zoneId", { category: "validation" });
        const type = String(input.config.recordType || "CNAME");
        const name = String(input.config.recordName || "");
        const content = String(input.config.recordContent || input.providerReferences.vercelDeploymentUrl || "");
        if (!name || !content) throw new ProviderError("missing DNS recordName/recordContent", { category: "validation" });
        const created = await this.client.createDnsRecord(zoneId, { type, name, content });
        // Read-back: the record must exist before success is reported.
        const verified = await this.client.getDnsRecord(zoneId, created.id);
        return {
          providerReference: `${zoneId}/${verified.id}`,
          output: { recordId: verified.id, type: verified.type, name: verified.name, content: verified.content },
          references: { dnsRecordReference: `${zoneId}/${verified.id}` },
          evidenceReference: `cloudflare:dns:${zoneId}/${verified.id}`,
        };
      }
      if (action === "verify_dns_record") {
        const reference = String(input.config.recordReference || input.providerReferences.dnsRecordReference || "");
        const [zone, recordId] = reference.split("/");
        if (!zone || !recordId) throw new ProviderError("missing DNS record reference to verify", { category: "validation" });
        const found = await this.client.getDnsRecord(zone, recordId);
        return {
          providerReference: reference,
          output: { recordId: found.id, name: found.name, content: found.content, verified: true },
          evidenceReference: `cloudflare:dns:${reference}`,
        };
      }
      throw new ProviderError(`Unsupported Cloudflare action ${action}`, { category: "validation" });
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      normalizeHttpError("cloudflare", error);
    }
  }

  async compensate(action: ProviderAction, input: ProviderCompensationInput) {
    if (action === "create_dns_record" && input.providerReference) {
      const [zoneId, recordId] = input.providerReference.split("/");
      if (!zoneId || !recordId) throw new ProviderError(`invalid DNS reference "${input.providerReference}"`, { category: "validation" });
      try {
        await this.client.deleteDnsRecord(zoneId, recordId);
      } catch (error) {
        normalizeHttpError("cloudflare", error);
      }
    }
  }
}

/** Real Resend email adapter. Email cannot be unsent: no compensation, declared truthfully. */
export class ResendEmailAdapter implements ProviderAdapter {
  provider = "resend";
  capability = "email" as const;
  actions: ProviderAction[] = ["send_email"];
  private client: ResendHttpClient;

  constructor(apiKey: string, client?: ResendHttpClient) {
    this.client = client ?? new ResendHttpClient(apiKey);
  }

  async execute(action: ProviderAction, input: ProviderExecutionInput): Promise<ProviderExecutionResult> {
    try {
      if (action !== "send_email") throw new ProviderError(`Unsupported Resend action ${action}`, { category: "validation" });
      const from = String(input.config.emailFrom || "");
      const to = String(input.config.emailTo || "");
      const subject = String(input.config.emailSubject || "");
      const text = String(input.config.emailBody || "");
      if (!from || !to || !subject) throw new ProviderError("missing emailFrom/emailTo/emailSubject", { category: "validation" });
      const sent = await this.client.sendEmail({ from, to, subject, text });
      return {
        providerReference: sent.id,
        output: { emailId: sent.id, to },
        references: { emailId: sent.id },
        evidenceReference: `resend:email:${sent.id}`,
      };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      normalizeHttpError("resend", error);
    }
  }
}

/** Real Stripe payments adapter (product provisioning at launch). */
export class StripePaymentsAdapter implements ProviderAdapter {
  provider = "stripe";
  capability = "payments" as const;
  actions: ProviderAction[] = ["create_product", "verify_product"];
  private client: StripeHttpClient;

  constructor(secretKey: string, client?: StripeHttpClient) {
    this.client = client ?? new StripeHttpClient(secretKey);
  }

  async execute(action: ProviderAction, input: ProviderExecutionInput): Promise<ProviderExecutionResult> {
    try {
      if (action === "create_product") {
        const name = String(input.config.productName || "");
        if (!name) throw new ProviderError("missing productName", { category: "validation" });
        const created = await this.client.createProduct({ name });
        const verified = await this.client.getProduct(created.id);
        return {
          providerReference: verified.id,
          output: { productId: verified.id, productName: verified.name, active: verified.active },
          references: { productId: verified.id },
          evidenceReference: `stripe:product:${verified.id}`,
        };
      }
      if (action === "verify_product") {
        const productId = String(input.config.productId || input.providerReferences.productId || input.providerReferences.stripeProductId || "");
        if (!productId) throw new ProviderError("missing productId to verify", { category: "validation" });
        const found = await this.client.getProduct(productId);
        return {
          providerReference: found.id,
          output: { productId: found.id, active: found.active, verified: true },
          evidenceReference: `stripe:product:${found.id}`,
        };
      }
      throw new ProviderError(`Unsupported Stripe action ${action}`, { category: "validation" });
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      normalizeHttpError("stripe", error);
    }
  }

  async compensate(action: ProviderAction, input: ProviderCompensationInput) {
    // Stripe products are archived, not destroyed — truthful partial rollback.
    if (action === "create_product" && input.providerReference) {
      try {
        await this.client.archiveProduct(input.providerReference);
      } catch (error) {
        normalizeHttpError("stripe", error);
      }
    }
  }
}

/** Real SignalWire telephony adapter. Sent SMS cannot be recalled: no compensation. */
export class SignalWireTelephonyAdapter implements ProviderAdapter {
  provider = "signalwire";
  capability = "telephony" as const;
  actions: ProviderAction[] = ["send_sms"];
  private client: SignalWireHttpClient;

  constructor(spaceUrl: string, projectId: string, apiToken: string, client?: SignalWireHttpClient) {
    this.client = client ?? new SignalWireHttpClient(spaceUrl, projectId, apiToken);
  }

  async execute(action: ProviderAction, input: ProviderExecutionInput): Promise<ProviderExecutionResult> {
    try {
      if (action !== "send_sms") throw new ProviderError(`Unsupported SignalWire action ${action}`, { category: "validation" });
      const from = String(input.config.smsFrom || "");
      const to = String(input.config.smsTo || "");
      const body = String(input.config.smsBody || "");
      if (!from || !to || !body) throw new ProviderError("missing smsFrom/smsTo/smsBody", { category: "validation" });
      const sent = await this.client.sendSms({ from, to, body });
      return {
        providerReference: sent.sid,
        output: { messageSid: sent.sid, status: sent.status, to },
        references: { messageSid: sent.sid },
        evidenceReference: `signalwire:sms:${sent.sid}`,
      };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      normalizeHttpError("signalwire", error);
    }
  }
}

// One execution registry per universal category. Legacy capability ids
// ("deployment", "telephony") normalize to their categories at every boundary.
const registries = new Map<ProviderCategory, ProviderRegistry<ProviderAdapter>>(
  PROVIDER_CATEGORIES.map((category) => [category, new ProviderRegistry<ProviderAdapter>(category)])
);

function registryFor(capability: string): ProviderRegistry<ProviderAdapter> {
  return registries.get(normalizeCategory(capability))!;
}

const repositoryRegistry = registryFor("repository");
const deploymentRegistry = registryFor("deployment");
const dnsRegistry = registryFor("dns");
const emailRegistry = registryFor("email");
const paymentsRegistry = registryFor("payments");
const telephonyRegistry = registryFor("telephony");
const storageRegistry = registryFor("storage");

repositoryRegistry.register(
  process.env.GITHUB_TOKEN ? new GitHubHttpAdapter(process.env.GITHUB_TOKEN) : new MockGitHubAdapter()
);
repositoryRegistry.register(new LocalGitAdapter());

deploymentRegistry.register(
  process.env.VERCEL_API_TOKEN ? new VercelHttpAdapter(process.env.VERCEL_API_TOKEN) : new MockVercelAdapter()
);

dnsRegistry.register(
  process.env.CLOUDFLARE_API_TOKEN
    ? new CloudflareDnsAdapter(process.env.CLOUDFLARE_API_TOKEN)
    : new MockDomainAdapter(
        "cloudflare",
        "dns",
        ["create_dns_record", "verify_dns_record", "issue_certificate", "verify_certificate"],
        ["create_dns_record", "issue_certificate"]
      )
);
emailRegistry.register(
  process.env.RESEND_API_KEY
    ? new ResendEmailAdapter(process.env.RESEND_API_KEY)
    : new MockDomainAdapter("resend", "email", ["send_email", "configure_email_domain", "configure_catch_all"], ["configure_email_domain", "configure_catch_all"])
);
paymentsRegistry.register(
  process.env.STRIPE_SECRET_KEY
    ? new StripePaymentsAdapter(process.env.STRIPE_SECRET_KEY)
    : new MockDomainAdapter("stripe", "payments", ["create_product", "verify_product"], ["create_product"])
);
telephonyRegistry.register(
  process.env.SIGNALWIRE_SPACE_URL && process.env.SIGNALWIRE_PROJECT_ID && process.env.SIGNALWIRE_API_TOKEN
    ? new SignalWireTelephonyAdapter(
        process.env.SIGNALWIRE_SPACE_URL,
        process.env.SIGNALWIRE_PROJECT_ID,
        process.env.SIGNALWIRE_API_TOKEN
      )
    : new MockDomainAdapter("signalwire", "telephony", ["send_sms"])
);
// Storage: local/test adapter only. A production object store is deferred
// until VERIDIAN artifact requirements land (documented launch-profile gap).
storageRegistry.register(new MockDomainAdapter("local-storage", "storage", ["store_artifact", "verify_artifact"], ["store_artifact"]));

/** Resolves an adapter by providerId alone (provider ids are unique across capabilities). */
export function getProviderAdapter(provider: string): ProviderAdapter {
  for (const registry of Array.from(registries.values())) {
    if (registry.has(provider)) return registry.get(provider);
  }
  // Fails closed with a typed, capability-agnostic error rather than crashing on undefined.
  return repositoryRegistry.get(provider);
}

export function listRegisteredProviders(capability?: ProviderCapability | string): string[] {
  if (capability) return registryFor(capability).list();
  return Array.from(new Set(Array.from(registries.values()).flatMap((registry) => registry.list()))).sort();
}

export function registerProviderAdapter(adapter: ProviderAdapter): void {
  registryFor(adapter.capability).register(adapter);
}

/**
 * Capability metadata: which providers exist per capability and which actions
 * each declares. Emits every universal category plus the legacy alias keys
 * ("deployment", "telephony") for pre-M2 consumers.
 */
export function listProviderMetadata() {
  const metadata: Record<string, Array<{ provider: string; actions: ProviderAction[]; mock: boolean }>> = {};
  const describe = (registry: ProviderRegistry<ProviderAdapter>) =>
    registry.list().map((id) => {
      const adapter = registry.get(id);
      return {
        provider: adapter.provider,
        actions: adapter.actions,
        mock:
          adapter instanceof MockDomainAdapter ||
          adapter.constructor.name.startsWith("Mock") ||
          ("manifest" in adapter && (adapter as { manifest?: { runtimeStatus?: string } }).manifest?.runtimeStatus === "mock"),
      };
    });
  for (const [category, registry] of Array.from(registries.entries())) {
    metadata[category] = describe(registry);
  }
  metadata.deployment = metadata.hosting;
  metadata.telephony = metadata.sms;
  return metadata;
}
