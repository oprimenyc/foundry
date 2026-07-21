import { z } from "zod";

/**
 * Foundry Email QA Contract — provider-neutral.
 *
 * Nothing here names a vendor (Resend, Postmark, SES, ...). A product config
 * describes what a *correct* email for that product looks like; a payload is
 * one concrete email to check against it. The validator (validate.ts) and the
 * outbound adapters (adapters/) are the only places that know about transport.
 */

export const EMAIL_CRITICALITY = ["low", "standard", "high", "release-blocking"] as const;
export type EmailCriticality = (typeof EMAIL_CRITICALITY)[number];

export const RECIPIENT_TYPES = ["customer", "internal", "admin", "test"] as const;
export type RecipientType = (typeof RECIPIENT_TYPES)[number];

export const VALIDATION_SEVERITIES = ["error", "warning"] as const;
export type ValidationSeverity = (typeof VALIDATION_SEVERITIES)[number];

export const VERDICTS = ["PASS", "FAIL", "BLOCKED", "PASS_WITH_WARNINGS"] as const;
export type EmailQaVerdict = (typeof VERDICTS)[number];

/** Sender identity a product declares as correct for its outbound email. */
export const SenderIdentitySchema = z.object({
  fromAddress: z.string().email(),
  fromName: z.string().min(1).optional(),
  replyTo: z.string().email().optional(),
});
export type SenderIdentity = z.infer<typeof SenderIdentitySchema>;

/** One email type/trigger a product sends (e.g. "welcome", "password_reset"). */
export const EmailTypeDefinitionSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  criticality: z.enum(EMAIL_CRITICALITY).default("standard"),
  /** Release-blocking types turn validation errors into a BLOCKED verdict instead of FAIL. */
  releaseBlocking: z.boolean().default(false),
  requiredTemplateVars: z.array(z.string().min(1)).default([]),
});
export type EmailTypeDefinition = z.infer<typeof EmailTypeDefinitionSchema>;

/** Which checks are mandatory for this product, and how strictly. */
export const ReleaseBlockingRulesSchema = z.object({
  requireNoUnresolvedPlaceholders: z.boolean().default(true),
  requireAllLinksResolve: z.boolean().default(true),
  requireSenderMatch: z.boolean().default(true),
  requireReplyToMatch: z.boolean().default(true),
  /** Missing asset severity when the email type itself isn't release-blocking. */
  missingAssetSeverity: z.enum(VALIDATION_SEVERITIES).default("warning"),
});
export type ReleaseBlockingRules = z.infer<typeof ReleaseBlockingRulesSchema>;

/** Provider-neutral product email config — the source of truth for QA. */
export const ProductEmailConfigSchema = z.object({
  productId: z.string().min(1),
  productName: z.string().min(1),
  sender: SenderIdentitySchema,
  /** Domains a `from` address is allowed to use for this product. */
  allowedFromDomains: z.array(z.string().min(1)).min(1),
  emailTypes: z.array(EmailTypeDefinitionSchema).min(1),
  /** Footer/legal links every email of this product must contain, resolved (no bare placeholder). */
  requiredFooterLinks: z.array(z.string().min(1)).default([]),
  requiredLegalText: z.array(z.string().min(1)).default([]),
  releaseBlockingRules: ReleaseBlockingRulesSchema.default({
    requireNoUnresolvedPlaceholders: true,
    requireAllLinksResolve: true,
    requireSenderMatch: true,
    requireReplyToMatch: true,
    missingAssetSeverity: "warning",
  }),
  /** True until the owning product repo is actually wired to this harness. */
  sample: z.boolean().default(false),
});
export type ProductEmailConfig = z.infer<typeof ProductEmailConfigSchema>;

/** One concrete email under test. */
export const EmailPayloadSchema = z.object({
  productId: z.string().min(1),
  emailType: z.string().min(1),
  recipient: z.object({
    type: z.enum(RECIPIENT_TYPES),
    address: z.string().email(),
  }),
  from: z.string().email(),
  fromName: z.string().min(1).optional(),
  replyTo: z.string().email().optional(),
  subject: z.string().min(1),
  templateInputs: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
  /** Fully rendered body (HTML or text) as it would leave the sender — may still contain unresolved placeholders, which is exactly what we're checking for. */
  renderedBody: z.string().min(1),
  /** Links this specific email must contain beyond the product's standing footer links. */
  requiredLinks: z.array(z.string().min(1)).default([]),
  /** Asset URLs/paths this email references and must resolve to a plausible shape. */
  requiredAssets: z.array(z.string().min(1)).default([]),
  /** Raw headers preserved where available (never required). */
  headers: z.record(z.string()).default({}),
});
export type EmailPayload = z.infer<typeof EmailPayloadSchema>;

export interface ValidationIssue {
  code: string;
  message: string;
  severity: ValidationSeverity;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
  checks: {
    productIdentity: { ok: boolean; issues: ValidationIssue[] };
    sender: { ok: boolean; issues: ValidationIssue[] };
    replyTo: { ok: boolean; issues: ValidationIssue[] };
    placeholders: { ok: boolean; unresolved: string[]; issues: ValidationIssue[] };
    links: { ok: boolean; missing: string[]; issues: ValidationIssue[] };
    assets: { ok: boolean; missing: string[]; issues: ValidationIssue[] };
    templateVars: { ok: boolean; missing: string[]; issues: ValidationIssue[] };
  };
  verdict: EmailQaVerdict;
}

/** Delivery/event correlation, when an outbound adapter actually ran. */
export interface DeliveryCorrelation {
  adapterId: string;
  mode: "fixture" | "resend-test" | "resend-live";
  providerReference: string;
  simulated: boolean;
  sentAt: string;
}

/** The standardized, machine-readable proof of one QA run. */
export interface EmailQaEvidencePackage {
  evidenceId: string;
  productId: string;
  emailType: string;
  productConfigHash: string;
  renderedPayloadHash: string;
  validation: ValidationResult;
  senderValidation: { ok: boolean; issues: ValidationIssue[] };
  replyToValidation: { ok: boolean; issues: ValidationIssue[] };
  placeholderCheck: { ok: boolean; unresolved: string[] };
  linkCheck: { ok: boolean; missing: string[] };
  assetCheck: { ok: boolean; missing: string[] };
  inboxMessageId: string;
  deliveryCorrelation?: DeliveryCorrelation;
  verdict: EmailQaVerdict;
  generatedAt: string;
}
