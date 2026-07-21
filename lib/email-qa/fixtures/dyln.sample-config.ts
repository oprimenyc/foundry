import type { ProductEmailConfig } from "../types";

/**
 * SAMPLE / FIXTURE ONLY — dyln's real repo is not wired to this harness.
 *
 * Shape of dyln's expected email QA config: branded sender, reply-to
 * expectation, a placeholder list of customer-facing email types, required
 * legal/footer links, and release-blocking rules. Uses the RFC 2606 reserved
 * "dyln.example" domain — never a real dyln address or URL. Do not treat any
 * value here as dyln's actual production configuration; do not modify the
 * dyln repository from Foundry (write boundary: this repo only).
 */
export const DYLN_SAMPLE_EMAIL_CONFIG: ProductEmailConfig = {
  productId: "dyln",
  productName: "dyln",
  sample: true,
  sender: {
    fromAddress: "no-reply@dyln.example",
    fromName: "dyln",
    replyTo: "support@dyln.example",
  },
  allowedFromDomains: ["dyln.example"],
  emailTypes: [
    {
      id: "welcome",
      description: "Sent after account creation — placeholder until dyln's real trigger list is confirmed.",
      criticality: "high",
      releaseBlocking: false,
      requiredTemplateVars: ["customerFirstName"],
    },
    {
      id: "password_reset",
      description: "Sent on password reset request — placeholder.",
      criticality: "release-blocking",
      releaseBlocking: true,
      requiredTemplateVars: ["resetLink", "expiresInMinutes"],
    },
    {
      id: "order_confirmation",
      description: "Sent after a completed order — placeholder.",
      criticality: "release-blocking",
      releaseBlocking: true,
      requiredTemplateVars: ["orderNumber", "orderTotal"],
    },
    {
      id: "shipping_notification",
      description: "Sent when an order ships — placeholder.",
      criticality: "high",
      releaseBlocking: false,
      requiredTemplateVars: ["orderNumber", "trackingLink"],
    },
    {
      id: "marketing_promo",
      description: "Marketing/promotional send — placeholder.",
      criticality: "standard",
      releaseBlocking: false,
      requiredTemplateVars: [],
    },
  ],
  requiredFooterLinks: [
    "https://dyln.example/unsubscribe",
    "https://dyln.example/legal/privacy",
    "https://dyln.example/legal/terms",
  ],
  requiredLegalText: ["dyln, Inc. — placeholder legal footer text until dyln confirms real copy"],
  releaseBlockingRules: {
    requireNoUnresolvedPlaceholders: true,
    requireAllLinksResolve: true,
    requireSenderMatch: true,
    requireReplyToMatch: true,
    missingAssetSeverity: "error",
  },
};
