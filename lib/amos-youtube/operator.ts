import { buildAmosYoutubePackageEvidence } from "./evidence";
import type { AmosYoutubePackageEvidence, AmosYoutubePackageVerdict } from "./types";

/**
 * Operator/query surface (mission Phase 6): what an operator needs to see
 * for the AMOS YouTube package bridge without ever implying a live provider
 * call happened. Mirrors lib/provider-actions/operator.ts.
 */
export interface AmosYoutubeBridgeOperatorReport {
  generatedAt: string;
  product: "amos";
  contentProviderDomain: "youtube_video_publishing";
  youtubePackageStatus: AmosYoutubePackageVerdict;
  packageContractCoverage: { total: number; present: number; missing: string[] };
  dryRunPublishVerdict: string;
  foundryEvidenceVerdict: AmosYoutubePackageVerdict;
  eveVerificationVerdict: "NOT_RUN_FROM_FOUNDRY";
  blockerWarningSummary: string[];
  liveYoutubeUploadFlag: false;
  googleApiCalledFlag: false;
  oauthMutatedFlag: false;
  providerMutatedFlag: false;
  evidenceRefs: string[];
  remainingOwnerActions: string[];
}

function remainingOwnerActions(evidence: AmosYoutubePackageEvidence): string[] {
  if (evidence.verdict === "PASS") {
    return evidence.approvalGateState.approved
      ? []
      : ["A human must review and decide the approval gate before any live publish is considered — this bridge performs no live action regardless."];
  }
  if (evidence.rejectionFindings.length > 0) {
    return evidence.rejectionFindings.map((f) => `Resolve rejection finding "${f.code}": ${f.message}`);
  }
  return evidence.capabilityCoverage.filter((c) => !c.present).map((c) => `Close capability gap: ${c.label}`);
}

/**
 * Builds the operator report for AMOS's YouTube package bridge. `eveVerificationVerdict` is always
 * "NOT_RUN_FROM_FOUNDRY" here — Foundry never runs VERIDIAN's E.V.E. verifier itself; that verdict
 * is only available from VERIDIAN's own operator surface / evidence/proofs/eve-amos-youtube-evidence.
 */
export async function getAmosYoutubeBridgeOperatorReport(
  options: Parameters<typeof buildAmosYoutubePackageEvidence>[0] = {},
): Promise<AmosYoutubeBridgeOperatorReport> {
  const evidence = await buildAmosYoutubePackageEvidence(options);
  const missing = evidence.capabilityCoverage.filter((c) => !c.present).map((c) => c.label);

  return {
    generatedAt: new Date().toISOString(),
    product: "amos",
    contentProviderDomain: "youtube_video_publishing",
    youtubePackageStatus: evidence.verdict,
    packageContractCoverage: { total: evidence.capabilityCoverage.length, present: evidence.capabilityCoverage.length - missing.length, missing },
    dryRunPublishVerdict: evidence.testProofRefs[0] ?? "",
    foundryEvidenceVerdict: evidence.verdict,
    eveVerificationVerdict: "NOT_RUN_FROM_FOUNDRY",
    blockerWarningSummary: evidence.rejectionFindings.map((f) => f.message),
    liveYoutubeUploadFlag: false,
    googleApiCalledFlag: false,
    oauthMutatedFlag: false,
    providerMutatedFlag: false,
    evidenceRefs: [evidence.evidenceId],
    remainingOwnerActions: remainingOwnerActions(evidence),
  };
}
