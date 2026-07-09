import { ProviderHTTPClient } from "./http-client";

export class VercelAdapter {
  private client = new ProviderHTTPClient();
  private baseUrl = "https://api.vercel.com";

  constructor(private apiToken: string) {
    if (!apiToken) throw new Error("VERCEL_API_TOKEN is required to use the Vercel adapter");
  }

  async createProject(config: { name: string; repoUrl: string }) {
    return this.client.request<{ id: string; name: string }>(
      `${this.baseUrl}/v10/projects`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiToken}`, "Content-Type": "application/json" },
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
      headers: { Authorization: `Bearer ${this.apiToken}` },
    });
  }
}
