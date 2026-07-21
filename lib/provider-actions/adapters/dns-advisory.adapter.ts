import type { ProviderActionAdvisory, ProviderActionGateReason, ProviderActionRequest } from "../types";
import type { ProviderActionAdapter } from "./types";

/**
 * DNS mutation advisory (Phase 2). Permanently advisory-only — see
 * policy.ts's PERMANENTLY_ADVISORY_ACTION_TYPES and the mission's own "DNS
 * mutation is advisory-only unless later explicitly enabled" rule. No live
 * DNS provider integration exists anywhere in this module; this adapter only
 * ever describes what a DNS change would require.
 */
export class DnsAdvisoryAdapter implements ProviderActionAdapter {
  readonly adapterId = "dns-advisory";
  readonly providerType = "generic_env" as const;
  readonly actionType = "dns_advisory" as const;

  advise(request: ProviderActionRequest, requiredApproval: ProviderActionGateReason[]): ProviderActionAdvisory {
    return {
      adapterId: this.adapterId,
      providerType: this.providerType,
      actionType: this.actionType,
      actionThatWouldBeTaken: `Describe (never perform) the DNS record change needed for "${request.targetDescription}" — this module has no DNS provider integration and cannot execute this action even with approval.`,
      requiredCredentials: ["DNS provider/registrar console access with permission to edit records (for the human who ultimately performs this)"],
      requiredApproval,
      mutationDisabled: true,
      liveCallMade: false,
      verificationSteps: ["DNS propagation confirmed via an external resolver query showing the expected record value.", "The service is reachable at the new/updated hostname."],
      rollbackSteps: ["Revert the DNS record to its previous value at the registrar/DNS provider and allow propagation."],
      evidenceRefs: request.rollbackPlan.concat(request.verificationPlan),
      prerequisiteMet: true,
    };
  }
}
