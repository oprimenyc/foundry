// DYLN launch-profile proof (safe local level: mock providers, stub verifier).
// One plan spans repository → deployment → DNS → payments → email → telephony,
// executes end-to-end, is independently verified, and then rolls back —
// exercising every capability the DYLN profile declares.
//   npm run proof:profile
import { rm } from "fs/promises";
import { createPlanForProject, createProject, createRunForProject, getRunView, seedMockCredentials } from "@/lib/foundry/service";
import { requestRollback } from "@/lib/foundry/execution";
import { getStoreSnapshot, resetFoundryPersistence } from "@/lib/foundry/store";
import { getVerificationView, verifyRunIndependently } from "@/lib/foundry/verification";

async function waitForTerminal(runId: string, timeoutMs = 15000) {
  const start = Date.now();
  for (;;) {
    const run = (await getStoreSnapshot()).runs.find((item) => item.id === runId);
    if (run && ["completed", "failed", "cancelled", "rolled_back"].includes(run.status)) return run;
    if (Date.now() - start > timeoutMs) throw new Error(`run ${runId} not terminal`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

const step = (id: string, provider: string, action: string, dependsOn: string[], config: Record<string, unknown>, rollbackAction?: string) => ({
  id,
  provider,
  action,
  name: `${provider}.${action}`,
  dependsOn,
  config,
  timeoutMs: 15000,
  retryLimit: 1,
  ...(rollbackAction ? { rollbackAction } : {}),
});

async function main() {
  process.env.FOUNDRY_STORE_FILE = `${process.cwd()}/.foundry-test-data/dyln-profile.json`;
  process.env.FOUNDRY_PERSISTENCE = "file";
  process.env.FOUNDRY_MASTER_KEY ||= "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  Object.assign(process.env, { NODE_ENV: "test" });
  await rm(process.env.FOUNDRY_STORE_FILE, { force: true });
  resetFoundryPersistence();

  const project = await createProject({ orgId: "org_dyln", name: "DYLN Launch", prompt: "Launch DYLN with repo, deploy, dns, payments and notifications" });
  await seedMockCredentials(project.id, "org_dyln");
  const { plan } = await createPlanForProject({
    orgId: "org_dyln",
    projectId: project.id,
    prompt: project.prompt,
    draftPlan: {
      config: { name: "DYLN", hosting: "vercel", repository: "dyln-app" },
      budget: { maxSteps: 10, maxRuntimeMs: 300000 },
      steps: [
        step("repo", "github", "create_repository", [], { repositoryName: "dyln-app" }, "create_repository"),
        step("vercel-project", "vercel", "create_project", ["repo"], { projectName: "dyln-app", credentialRef: "secret:vercel/deployment" }, "create_project"),
        step("deploy", "vercel", "trigger_deployment", ["vercel-project"], {}),
        step("deploy-verify", "vercel", "verify_deployment", ["deploy"], {}),
        step("dns", "cloudflare", "create_dns_record", ["deploy-verify"], { zoneId: "zone-dyln", recordType: "CNAME", recordName: "app.dyln.io", recordContent: "cname.vercel-dns.com" }, "create_dns_record"),
        step("payments", "stripe", "create_product", ["deploy-verify"], { productName: "DYLN Membership", credentialRef: "secret:stripe/payments" }, "create_product"),
        step("email", "resend", "send_email", ["dns", "payments"], { emailFrom: "ops@dyln.io", emailTo: "owner@dyln.io", emailSubject: "DYLN launched", emailBody: "Launch complete" }),
        step("sms", "signalwire", "send_sms", ["dns", "payments"], { smsFrom: "+15550001111", smsTo: "+15550002222", smsBody: "DYLN launched" }),
      ],
    },
  });
  if (plan.status !== "validated") throw new Error(`plan rejected: ${plan.validationErrors.join(", ")}`);

  const run = await createRunForProject({ orgId: "org_dyln", projectId: project.id, planId: plan.id, idempotencyKey: "dyln-profile", requestedBy: "profile-proof" });
  const terminal = await waitForTerminal(run.id);
  const view = await getRunView(project.id, run.id, "org_dyln");

  await verifyRunIndependently(run.id, { fetchImpl: async () => ({ ok: true, status: 200 }) });
  const verification = await getVerificationView(run.id);

  await requestRollback(run.id);
  const rolledBack = await waitForTerminal(run.id);

  const summary = {
    profile: "DYLN",
    planSteps: plan.steps.length,
    runStatus: terminal.status,
    completedSteps: view?.steps.filter((item) => item.status === "completed").length,
    capabilitiesExercised: Array.from(new Set(plan.steps.map((item) => item.provider))),
    independentlyVerified: verification.independentlyVerified,
    rollbackStatus: rolledBack.status,
    rolledBackSteps: (await getStoreSnapshot()).steps.filter((item) => item.runId === run.id && item.status === "rolled_back").length,
  };
  console.log(JSON.stringify(summary, null, 2));
  const ok = terminal.status === "completed" && verification.independentlyVerified && rolledBack.status === "rolled_back";
  if (!ok) process.exit(1);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
