import type { RemediationAdvisory, RemediationPlan, SecretExposureFinding } from "../types";
import type { SecretRemediationAdapter } from "./types";

/**
 * Git history rewrite advisory (Task 4). Never runs `git filter-repo`/BFG and
 * never force-pushes — history rewrite is the single most irreversible
 * action this mission covers, so this adapter only ever describes it.
 */
export class GitHistoryRewriteAdapter implements SecretRemediationAdapter {
  readonly adapterId = "git-history-rewrite-advisory";
  readonly provider = "git-history" as const;

  appliesTo(finding: SecretExposureFinding): boolean {
    return finding.historyRewriteRequired !== "not_applicable";
  }

  advise(finding: SecretExposureFinding, plan: RemediationPlan): RemediationAdvisory {
    return {
      adapterId: this.adapterId,
      provider: this.provider,
      action: "rewrite_git_history_and_force_push",
      wouldAct: finding.historyRewriteRequired === "required" || finding.historyRewriteRequired === "optional",
      blocked: true,
      requiredApproval: plan.humanApprovalGates.filter((g) => g.reason === "git_history_rewrite" || g.reason === "force_push").map((g) => g.reason),
      requiredCredentials: ["Repository admin access, git filter-repo or BFG Repo-Cleaner, and force-push rights on every affected remote"],
      verificationRequirement:
        "Exposed file/content no longer appears anywhere in `git log --all -- <path>`; every collaborator has re-cloned or hard-reset after the force-push.",
      evidenceRefs: plan.evidenceRequirements,
      noRealMutationConfirmed: true,
    };
  }
}
