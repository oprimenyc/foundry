import { randomUUID } from "crypto";
import type { ProviderAction } from "./types";
import { ProviderRegistry } from "./registry";
import { VercelAdapter as VercelHttpClient } from "@/lib/providers/vercel.adapter";

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
  evidenceReference?: string;
}

export interface ProviderCompensationInput extends ProviderExecutionInput {
  providerReference?: string;
}

export type ProviderCapability = "repository" | "deployment";

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

class MockGitHubAdapter implements ProviderAdapter {
  provider = "github";
  capability = "repository" as const;
  actions: ProviderAction[] = ["create_repository", "verify_repository"];
  private repos = new Map<string, ProviderExecutionResult>();

  async execute(action: ProviderAction, input: ProviderExecutionInput): Promise<ProviderExecutionResult> {
    if (action === "create_repository") {
      const key = `${input.runId}:${input.stepId}`;
      const existing = this.repos.get(key);
      if (existing) return existing;
      const repoName = String(input.config.repositoryName || input.config.projectName || "foundry-app");
      const result = {
        providerReference: `gh_repo_${randomUUID()}`,
        output: {
          repoUrl: `https://github.com/mock-org/${repoName}`,
          repositoryId: key,
          defaultBranch: "main",
        },
        evidenceReference: `github:${repoName}`,
      };
      this.repos.set(key, result);
      return result;
    }

    if (action === "verify_repository") {
      const repoUrl = String(input.providerReferences.githubRepoUrl || "");
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
      const result = {
        providerReference: `local_repo_${randomUUID()}`,
        output: { repoUrl: `file:///var/foundry/repos/${repoName}.git`, repositoryId: key, defaultBranch: "main" },
        evidenceReference: `local-git:${repoName}`,
      };
      this.repos.set(key, result);
      return result;
    }
    if (action === "verify_repository") {
      const repoUrl = String(input.providerReferences.githubRepoUrl || input.providerReferences.repoUrl || "");
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
    const key = `${input.runId}:${input.stepId}`;
    if (action === "create_project") {
      const existing = this.projects.get(key);
      if (existing) return existing;
      const projectName = String(input.config.projectName || input.config.repositoryName || "foundry-app");
      const repoUrl = String(input.providerReferences.githubRepoUrl || "");
      if (!repoUrl) throw new Error("missing GitHub repository URL");
      const result = {
        providerReference: `vercel_project_${randomUUID()}`,
        output: { projectId: key, projectName, repoUrl },
        evidenceReference: `vercel:${projectName}`,
      };
      this.projects.set(key, result);
      return result;
    }

    if (action === "trigger_deployment") {
      const projectId = String(input.providerReferences.vercelProjectId || "");
      if (!projectId) throw new Error("missing Vercel project");
      return {
        providerReference: `vercel_deploy_${randomUUID()}`,
        output: {
          deploymentId: `deploy_${input.runId}`,
          deploymentUrl: `https://${input.projectId}.mock-vercel.app`,
          state: "READY",
        },
        evidenceReference: `https://${input.projectId}.mock-vercel.app`,
      };
    }

    if (action === "verify_deployment") {
      const deploymentUrl = String(input.providerReferences.vercelDeploymentUrl || "");
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
      const repoUrl = String(input.providerReferences.githubRepoUrl || "");
      if (!repoUrl) throw new Error("missing GitHub repository URL");
      const created = await this.client.createProject({ name: projectName, repoUrl });
      return {
        providerReference: created.id,
        output: { projectId: created.id, projectName: created.name, repoUrl },
        evidenceReference: `vercel:${created.name}`,
      };
    }
    if (action === "trigger_deployment") {
      const projectName = String(input.config.projectName || input.providerReferences.vercelProjectName || "foundry-app");
      const repoUrl = String(input.providerReferences.githubRepoUrl || "");
      if (!repoUrl) throw new ProviderError("missing GitHub repository URL for deployment", { category: "validation" });
      const deployment = await this.client.createDeployment({
        projectName,
        repoUrl,
        ref: input.config.gitRef ? String(input.config.gitRef) : undefined,
      });
      return {
        providerReference: deployment.id,
        output: {
          deploymentId: deployment.id,
          deploymentUrl: deployment.url.startsWith("http") ? deployment.url : `https://${deployment.url}`,
          readyState: deployment.readyState,
        },
        evidenceReference: `vercel:deployment:${deployment.id}`,
      };
    }
    if (action === "verify_deployment") {
      const deploymentId = String(input.config.deploymentId || input.providerReferences.vercelDeploymentId || "");
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

const repositoryRegistry = new ProviderRegistry<ProviderAdapter>("repository");
const deploymentRegistry = new ProviderRegistry<ProviderAdapter>("deployment");

repositoryRegistry.register(new MockGitHubAdapter());
repositoryRegistry.register(new LocalGitAdapter());

deploymentRegistry.register(
  process.env.VERCEL_API_TOKEN ? new VercelHttpAdapter(process.env.VERCEL_API_TOKEN) : new MockVercelAdapter()
);

const registries: Record<ProviderCapability, ProviderRegistry<ProviderAdapter>> = {
  repository: repositoryRegistry,
  deployment: deploymentRegistry,
};

/** Resolves an adapter by providerId alone (provider ids are unique across capabilities). */
export function getProviderAdapter(provider: string): ProviderAdapter {
  for (const registry of Object.values(registries)) {
    if (registry.has(provider)) return registry.get(provider);
  }
  // Fails closed with a typed, capability-agnostic error rather than crashing on undefined.
  return repositoryRegistry.get(provider);
}

export function listRegisteredProviders(capability?: ProviderCapability): string[] {
  if (capability) return registries[capability].list();
  return Array.from(new Set(Object.values(registries).flatMap((registry) => registry.list()))).sort();
}

export function registerProviderAdapter(adapter: ProviderAdapter): void {
  registries[adapter.capability].register(adapter);
}
