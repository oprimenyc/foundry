import { ProviderHTTPClient } from "./http-client";

export type VercelDeploymentState = "QUEUED" | "BUILDING" | "INITIALIZING" | "READY" | "ERROR" | "CANCELED";

export interface VercelDeployment {
  id: string;
  url: string;
  readyState: VercelDeploymentState;
}

export class VercelAdapter {
  private baseUrl = "https://api.vercel.com";

  constructor(
    private apiToken: string,
    private client: ProviderHTTPClient = new ProviderHTTPClient()
  ) {
    if (!apiToken) throw new Error("VERCEL_API_TOKEN is required to use the Vercel adapter");
  }

  private authHeaders(json = false): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiToken}`,
      ...(json ? { "Content-Type": "application/json" } : {}),
    };
  }

  async createProject(config: { name: string; repoUrl: string }) {
    return this.client.request<{ id: string; name: string }>(
      `${this.baseUrl}/v10/projects`,
      {
        method: "POST",
        headers: this.authHeaders(true),
        body: JSON.stringify({
          name: config.name.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
          gitRepository: { type: "github", repo: config.repoUrl.replace("https://github.com/", "") },
        }),
      },
      true
    );
  }

  async deleteProject(projectId: string) {
    return this.client.request<void>(`${this.baseUrl}/v9/projects/${projectId}`, {
      method: "DELETE",
      headers: this.authHeaders(),
    });
  }

  /** Triggers a git-sourced deployment for a project. */
  async createDeployment(config: { projectName: string; repoUrl: string; ref?: string }) {
    const [org, repo] = config.repoUrl.replace("https://github.com/", "").split("/");
    if (!org || !repo) throw new Error(`cannot derive org/repo from repository URL "${config.repoUrl}"`);
    return this.client.request<VercelDeployment>(
      `${this.baseUrl}/v13/deployments`,
      {
        method: "POST",
        headers: this.authHeaders(true),
        body: JSON.stringify({
          name: config.projectName,
          project: config.projectName,
          gitSource: { type: "github", org, repo, ref: config.ref || "main" },
        }),
      },
      true
    );
  }

  async getDeployment(deploymentId: string) {
    return this.client.request<VercelDeployment>(`${this.baseUrl}/v13/deployments/${deploymentId}`, {
      method: "GET",
      headers: this.authHeaders(),
    });
  }

  async cancelDeployment(deploymentId: string) {
    return this.client.request<VercelDeployment>(`${this.baseUrl}/v12/deployments/${deploymentId}/cancel`, {
      method: "PATCH",
      headers: this.authHeaders(),
    });
  }

  /**
   * Polls a deployment until it reaches a terminal state. Throws on ERROR or
   * CANCELED; the caller's step timeout bounds total wait.
   */
  async waitForDeployment(deploymentId: string, pollIntervalMs = 3000): Promise<VercelDeployment> {
    for (;;) {
      const deployment = await this.getDeployment(deploymentId);
      if (deployment.readyState === "READY") return deployment;
      if (deployment.readyState === "ERROR" || deployment.readyState === "CANCELED") {
        throw new Error(`Vercel deployment ${deploymentId} ended in state ${deployment.readyState}`);
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
  }
}
