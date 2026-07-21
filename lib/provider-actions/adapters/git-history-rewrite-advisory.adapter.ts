import type { ProviderActionAdvisory, ProviderActionGateReason, ProviderActionRequest } from "../types";
import type { ProviderActionAdapter } from "./types";

/**
 * Git history rewrite advisory (Phase 2). Permanently advisory-only — see
 * policy.ts's PERMANENTLY_ADVISORY_ACTION_TYPES. Mirrors
 * lib/secret-remediation/adapters/git-history.adapter.ts's reasoning: a
 * rewrite followed by a force-push breaks every downstream clone/fork/PR,
 * which is exactly why force-push carries its own, separate approval gate
 * (see policy.ts — only added when request.forcePushRequired is true).
 */
export class GitHistoryRewriteAdvisoryAdapter implements ProviderActionAdapter {
  readonly adapterId = "git-history-rewrite-advisory";
  readonly providerType = "github" as const;
  readonly actionType = "git_history_rewrite_advisory" as const;

  advise(request: ProviderActionRequest, requiredApproval: ProviderActionGateReason[]): ProviderActionAdvisory {
    return {
      adapterId: this.adapterId,
      providerType: this.providerType,
      actionType: this.actionType,
      actionThatWouldBeTaken: `Describe (never perform) a history rewrite (git filter-repo or BFG Repo-Cleaner) for "${request.targetDescription}"${request.forcePushRequired ? ", followed by a force-push" : ""}. This module never runs a rewrite or a force-push itself.`,
      requiredCredentials: ["Repository admin access, plus every collaborator's cooperation to re-clone/hard-reset after any rewrite"],
      requiredApproval,
      mutationDisabled: true,
      liveCallMade: false,
      verificationSteps: ["The exposed content no longer appears anywhere in the rewritten history (verified via a fresh clone, not the working copy that performed the rewrite)."],
      rollbackSteps: ["A history rewrite has no clean rollback once force-pushed — the only recovery is restoring from a pre-rewrite mirror clone, which itself must be coordinated as its own approved action."],
      evidenceRefs: request.rollbackPlan.concat(request.verificationPlan),
      prerequisiteMet: true,
    };
  }
}
