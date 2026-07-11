import { ProviderHTTPClient } from "./http-client";

export interface GitHubRepository {
  id: number;
  full_name: string;
  html_url: string;
  default_branch: string;
  private: boolean;
}

const NAME_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,98}[A-Za-z0-9._-])?$/;
const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

export function assertSafeRepoName(name: string): string {
  if (!NAME_PATTERN.test(name) || name.includes("..")) {
    throw new Error(`unsafe repository name "${name}"`);
  }
  return name;
}

export function assertSafeOwner(owner: string): string {
  if (!OWNER_PATTERN.test(owner) || owner.includes("..")) {
    throw new Error(`unsafe repository owner "${owner}"`);
  }
  return owner;
}

export class GitHubAdapter {
  private baseUrl = "https://api.github.com";

  constructor(
    private apiToken: string,
    private client: ProviderHTTPClient = new ProviderHTTPClient()
  ) {
    if (!apiToken) throw new Error("GITHUB_TOKEN is required to use the GitHub adapter");
  }

  private authHeaders(json = false): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiToken}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(json ? { "Content-Type": "application/json" } : {}),
    };
  }

  /** Creates a repository for the authenticated user (or org when owner given). */
  async createRepository(config: { name: string; org?: string; description?: string; isPrivate?: boolean }) {
    const name = assertSafeRepoName(config.name);
    const url = config.org
      ? `${this.baseUrl}/orgs/${assertSafeOwner(config.org)}/repos`
      : `${this.baseUrl}/user/repos`;
    return this.client.request<GitHubRepository>(
      url,
      {
        method: "POST",
        headers: this.authHeaders(true),
        body: JSON.stringify({
          name,
          description: config.description || "Created by Foundry",
          private: config.isPrivate ?? true,
          auto_init: true,
        }),
      },
      true
    );
  }

  /** Reads repository metadata; the canonical existence/access check. */
  async getRepository(owner: string, name: string) {
    return this.client.request<GitHubRepository>(
      `${this.baseUrl}/repos/${assertSafeOwner(owner)}/${assertSafeRepoName(name)}`,
      { method: "GET", headers: this.authHeaders() }
    );
  }

  /** Compensation for createRepository. Requires delete_repo scope. */
  async deleteRepository(owner: string, name: string) {
    return this.client.request<void>(
      `${this.baseUrl}/repos/${assertSafeOwner(owner)}/${assertSafeRepoName(name)}`,
      { method: "DELETE", headers: this.authHeaders() }
    );
  }
}
