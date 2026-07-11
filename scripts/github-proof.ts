// GitHub repository provider proof.
//
// Offline (default): runs the real GitHubHttpAdapter against a stubbed HTTP
// transport — proves create → independent read-back → verify → compensate
// end-to-end without credentials.
//
// Live (GITHUB_PROOF_LIVE=1 + GITHUB_TOKEN): performs the same flow against
// the real GitHub API using a throwaway repository name, then deletes it.
// Credential-blocked only at this final boundary.
//
//   npm run proof:github
//   GITHUB_PROOF_LIVE=1 GITHUB_TOKEN=... npm run proof:github
import { GitHubAdapter } from "@/lib/providers/github.adapter";
import { GitHubHttpAdapter } from "@/lib/foundry/providers";
import type { ProviderHTTPClient } from "@/lib/providers/http-client";

const live = process.env.GITHUB_PROOF_LIVE === "1";

function offlineTransport() {
  const repos = new Map<string, { id: number; full_name: string; html_url: string; default_branch: string; private: boolean }>();
  let nextId = 1000;
  const calls: string[] = [];
  const client = {
    async request(url: string, options: RequestInit = {}) {
      calls.push(`${options.method} ${url}`);
      const method = options.method;
      if (method === "POST" && url.endsWith("/user/repos")) {
        const body = JSON.parse(String(options.body)) as { name: string };
        const repo = {
          id: nextId++,
          full_name: `offline-org/${body.name}`,
          html_url: `https://github.com/offline-org/${body.name}`,
          default_branch: "main",
          private: true,
        };
        repos.set(repo.full_name, repo);
        return repo;
      }
      const match = url.match(/\/repos\/([^/]+\/[^/]+)$/);
      if (method === "GET" && match) {
        const repo = repos.get(match[1]);
        if (!repo) throw new Error(`404: repository ${match[1]} not found`);
        return repo;
      }
      if (method === "DELETE" && match) {
        if (!repos.delete(match[1])) throw new Error(`404: repository ${match[1]} not found`);
        return undefined;
      }
      throw new Error(`unexpected request ${method} ${url}`);
    },
  } as unknown as ProviderHTTPClient;
  return { client, calls, repos };
}

async function main() {
  const repoName = `foundry-proof-${Date.now().toString(36)}`;
  let adapter: GitHubHttpAdapter;
  let transport: ReturnType<typeof offlineTransport> | undefined;

  if (live) {
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      console.error("BLOCKED: GITHUB_PROOF_LIVE=1 requires GITHUB_TOKEN");
      process.exit(2);
    }
    adapter = new GitHubHttpAdapter(token);
  } else {
    transport = offlineTransport();
    adapter = new GitHubHttpAdapter("offline-token", new GitHubAdapter("offline-token", transport.client));
  }

  const input = { runId: "proof-run", stepId: "proof-step", projectId: "proof-project" };

  const created = await adapter.execute("create_repository", {
    ...input,
    config: { repositoryName: repoName },
    providerReferences: {},
  });
  const verified = await adapter.execute("verify_repository", {
    ...input,
    config: {},
    providerReferences: { githubRepoUrl: String(created.output.repoUrl) },
  });
  await adapter.compensate?.("create_repository", {
    ...input,
    config: {},
    providerReferences: {},
    providerReference: created.providerReference,
  });

  // After compensation the repository must be gone.
  let deleted = false;
  try {
    await adapter.execute("verify_repository", {
      ...input,
      config: { repositoryFullName: created.providerReference },
      providerReferences: {},
    });
  } catch {
    deleted = true;
  }

  console.log(
    JSON.stringify(
      {
        mode: live ? "live" : "offline-stub",
        created: created.providerReference,
        repoUrl: created.output.repoUrl,
        verified: verified.output.verified === true,
        compensationDeleted: deleted,
        httpCalls: transport?.calls.length,
      },
      null,
      2
    )
  );
  if (!(verified.output.verified === true && deleted)) process.exit(1);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
