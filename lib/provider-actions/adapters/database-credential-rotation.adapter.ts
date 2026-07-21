import type { ProviderActionAdvisory, ProviderActionGateReason, ProviderActionRequest } from "../types";
import type { ProviderActionAdapter } from "./types";

/** Database credential rotation advisory (Phase 2). Never connects to or mutates the database provider. */
export class DatabaseCredentialRotationAdapter implements ProviderActionAdapter {
  readonly adapterId = "database-credential-rotation-advisory";
  readonly providerType = "database" as const;
  readonly actionType = "rotate_credential" as const;

  advise(request: ProviderActionRequest, requiredApproval: ProviderActionGateReason[]): ProviderActionAdvisory {
    const prerequisiteMet = !request.knownPrerequisiteGaps.includes("database-console-access");
    return {
      adapterId: this.adapterId,
      providerType: this.providerType,
      actionType: this.actionType,
      actionThatWouldBeTaken: `Rotate the database credential for "${request.targetDescription}" from the provider's own console (Neon/Supabase/RDS/etc.) and invalidate the previous connection string once the new one is confirmed live.`,
      requiredCredentials: ["Database provider console access (Neon/Supabase/RDS/etc.) with permission to rotate credentials"],
      requiredApproval,
      mutationDisabled: true,
      liveCallMade: false,
      verificationSteps: ["Application connects successfully with the newly rotated connection string in every environment.", "The old connection string no longer authenticates."],
      rollbackSteps: ["Keep the previous connection string documented for emergency rollback only until the new one is verified stable, then discard it."],
      evidenceRefs: request.rollbackPlan.concat(request.verificationPlan),
      prerequisiteMet,
      blockedReason: prerequisiteMet ? undefined : "database provider console access with credential-rotation permission is not confirmed available",
    };
  }
}
