import type { EmailTypeDefinition, ProductEmailConfig } from "../types";

/**
 * CONFIRMED dyln product email config — sample: false.
 *
 * Superseded `dyln.sample-config.ts` (deleted; was `sample: true`, RFC 2606
 * `dyln.example` placeholder domain). Values below are derived from dyln's own
 * audited handoff to Foundry — `DYLN_EMAIL_QA_INVENTORY.md` and
 * `DYLN_FOUNDRY_EMAIL_QA_HANDOFF.md` in `C:\REPLIT PROJECTS\dyln\dyln`
 * (HEAD `9f03187b9ec5e5dbe9ba80c781a1b514db62c63b`) — not inferred by Foundry.
 * See FOUNDRY_DYLN_EMAIL_QA_CURRENT_TRUTH.md for the mapping decisions below.
 *
 * Do not modify the dyln repository from Foundry (write boundary: this repo only).
 */

/**
 * dyln's fixture criticality strings -> Foundry's EmailCriticality + releaseBlocking.
 * release-critical/revenue-critical collapse to Foundry's "release-blocking" tier
 * (Constitution §2: revenue-critical failures block release) so a validation
 * error on those email types surfaces as BLOCKED, not merely FAIL.
 */
export const DYLN_CRITICALITY_MAP: Record<string, Pick<EmailTypeDefinition, "criticality" | "releaseBlocking">> = {
  "release-critical": { criticality: "release-blocking", releaseBlocking: true },
  "revenue-critical": { criticality: "release-blocking", releaseBlocking: true },
  high: { criticality: "high", releaseBlocking: false },
  medium: { criticality: "standard", releaseBlocking: false },
  low: { criticality: "low", releaseBlocking: false },
};

function emailType(id: string, description: string, dylnCriticality: string, requiredTemplateVars: string[]): EmailTypeDefinition {
  const mapped = DYLN_CRITICALITY_MAP[dylnCriticality];
  if (!mapped) throw new Error(`dyln.config.ts: unknown dyln criticality "${dylnCriticality}" for email type "${id}"`);
  return { id, description, criticality: mapped.criticality, releaseBlocking: mapped.releaseBlocking, requiredTemplateVars };
}

export const DYLN_EMAIL_CONFIG: ProductEmailConfig = {
  productId: "dyln",
  productName: "dyln",
  sample: false,
  sender: {
    // Canonical Tier A sender. `follow-up-email` uses `noreply@getdyln.com`
    // instead (a separate module, a real cross-cutting inconsistency dyln's
    // own inventory flags as gap #3) — Foundry does not "fix" this by
    // widening the config to accept two senders; that fixture is expected to
    // (and does) surface a real SENDER_MISMATCH FAIL. See current-truth doc.
    fromAddress: "support@getdyln.com",
    // No reply-to expected: every dyln fixture has replyToExplicit:false —
    // Resend's implicit from-address default is relied on, no code sets a
    // reply_to header anywhere in the live path. Leaving this unset makes
    // Foundry assert "absent", matching the dyln handoff's own instruction.
  },
  allowedFromDomains: ["getdyln.com"],
  emailTypes: [
    emailType("welcome", "Welcome email — fires after account creation", "release-critical", ["firstName"]),
    emailType("onboarding-day1", "Onboarding Day 1 nudge — \"get your business number\"", "medium", ["firstName"]),
    emailType("onboarding-day3", "Onboarding Day 3 nudge — \"3 features you might have missed\"", "medium", ["firstName"]),
    emailType("subscription-confirmed", "Subscription confirmation after successful checkout/payment", "revenue-critical", [
      "firstName",
      "planLabel",
      "amountFormatted",
      "cycleLabel",
    ]),
    emailType("payment-confirmed", "Payment confirmation receipt", "revenue-critical", ["firstName", "amount", "description", "dateStr"]),
    emailType("payment-failed", "Payment failed — dunning notice", "revenue-critical", ["firstName", "amount"]),
    emailType("subscription-cancelled", "Subscription cancellation confirmation", "high", ["firstName", "dateStr"]),
    emailType("business-credit-received", "Business credit application received (after $79 setup fee)", "revenue-critical", ["firstName"]),
    emailType("sms-activation", "SMS/10DLC campaign activation notice", "high", ["firstName", "phoneNumber"]),
    emailType("voicemail-notification", "New voicemail notification with transcript preview", "high", [
      "callerNumber",
      "timeStr",
      "durationStr",
      "transcript",
    ]),
    emailType("missed-call-alert", "Missed call alert", "high", ["callerNumber", "timeStr"]),
    emailType("ai-degradation-alert", "AI receptionist degradation service notice", "high", ["businessName", "failureCount"]),
    emailType("contact-sales-admin-notification", "Enterprise contact form — internal admin notification", "revenue-critical", [
      "companyName",
      "fullName",
      "email",
      "phoneNumber",
      "companySize",
      "monthlyVolume",
      "requirements",
      "preferredContactMethod",
      "bestTime",
    ]),
    emailType("contact-sales-customer-autoreply", "Enterprise contact form — customer auto-reply", "revenue-critical", [
      "firstName",
      "companyName",
      "contactMethodText",
      "timeFrameText",
    ]),
    emailType("waitlist-confirmation", "Waitlist signup confirmation", "medium", []),
    emailType("waitlist-admin-notification", "Waitlist signup — internal admin notification", "low", ["email"]),
    emailType("follow-up-email", "CRM follow-up draft, sent after user/agent approval", "high", ["fromName"]),
  ],
  // No product-wide required footer link: 13 of 17 dyln emails go through
  // emailShell() (unsubscribe + copyright footer), 4 hand-rolled templates
  // have none. The real unsubscribe link is asserted per-payload instead
  // (see dyln-loader.ts's mapDylnFixtureToPayload), using the schema's
  // existing per-email requiredLinks extension point rather than changing
  // the shared, product-neutral contract.
  requiredFooterLinks: [],
  requiredLegalText: [],
  releaseBlockingRules: {
    requireNoUnresolvedPlaceholders: true,
    requireAllLinksResolve: true,
    requireSenderMatch: true,
    requireReplyToMatch: false,
    missingAssetSeverity: "warning",
  },
};
