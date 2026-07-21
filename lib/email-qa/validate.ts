import {
  ProductEmailConfigSchema,
  type EmailPayload,
  type EmailTypeDefinition,
  type ProductEmailConfig,
  type ValidationIssue,
  type ValidationResult,
} from "./types";

/**
 * Free, local, deterministic email QA validator. No network calls, no
 * provider credentials — runs entirely against the contract in types.ts.
 */

// Common template-engine placeholder shapes: {{var}}, {{ var.path }}, ${var}, %%var%%, [[var]].
const PLACEHOLDER_PATTERNS: RegExp[] = [
  /\{\{\s*([\w.]+)\s*\}\}/g,
  /\$\{\s*([\w.]+)\s*\}/g,
  /%%\s*([\w.]+)\s*%%/g,
  /\[\[\s*([\w.]+)\s*\]\]/g,
];

export function findUnresolvedPlaceholders(text: string): string[] {
  const found = new Set<string>();
  for (const pattern of PLACEHOLDER_PATTERNS) {
    Array.from(text.matchAll(pattern)).forEach((match) => found.add(match[0]));
  }
  return Array.from(found);
}

function domainOf(email: string): string {
  return email.split("@")[1]?.toLowerCase() ?? "";
}

export function validateProductEmailConfig(input: unknown): { ok: boolean; config?: ProductEmailConfig; issues: ValidationIssue[] } {
  const parsed = ProductEmailConfigSchema.safeParse(input);
  if (parsed.success) return { ok: true, config: parsed.data, issues: [] };
  const issues: ValidationIssue[] = parsed.error.issues.map((issue) => ({
    code: "CONFIG_SCHEMA_INVALID",
    message: `${issue.path.join(".") || "(root)"}: ${issue.message}`,
    severity: "error",
  }));
  return { ok: false, issues };
}

function validateProductIdentity(config: ProductEmailConfig, payload: EmailPayload): { ok: boolean; issues: ValidationIssue[] } {
  if (payload.productId === config.productId) return { ok: true, issues: [] };
  const issue: ValidationIssue = {
    code: "PRODUCT_IDENTITY_MISMATCH",
    message: `payload productId "${payload.productId}" does not match the product config being validated against ("${config.productId}")`,
    severity: "error",
  };
  return { ok: false, issues: [issue] };
}

function validateSender(config: ProductEmailConfig, payload: EmailPayload): { ok: boolean; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  const { requireSenderMatch } = config.releaseBlockingRules;

  if (requireSenderMatch && payload.from !== config.sender.fromAddress) {
    issues.push({
      code: "SENDER_MISMATCH",
      message: `from address "${payload.from}" does not match declared sender "${config.sender.fromAddress}"`,
      severity: "error",
    });
  }

  const domain = domainOf(payload.from);
  if (!config.allowedFromDomains.includes(domain)) {
    issues.push({
      code: "SENDER_DOMAIN_NOT_ALLOWED",
      message: `from domain "${domain}" is not in the product's allowed domains [${config.allowedFromDomains.join(", ")}]`,
      severity: "error",
    });
  }

  if (config.sender.fromName && payload.fromName && payload.fromName !== config.sender.fromName) {
    issues.push({
      code: "SENDER_NAME_MISMATCH",
      message: `from name "${payload.fromName}" does not match declared sender name "${config.sender.fromName}"`,
      severity: "warning",
    });
  }

  return { ok: issues.every((i) => i.severity !== "error"), issues };
}

function validateReplyTo(config: ProductEmailConfig, payload: EmailPayload): { ok: boolean; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  const expected = config.sender.replyTo;
  if (!expected || !config.releaseBlockingRules.requireReplyToMatch) return { ok: true, issues };

  if (!payload.replyTo) {
    issues.push({ code: "REPLY_TO_MISSING", message: `reply-to is required and expected to be "${expected}" but was not set`, severity: "error" });
  } else if (payload.replyTo !== expected) {
    issues.push({
      code: "REPLY_TO_MISMATCH",
      message: `reply-to "${payload.replyTo}" does not match declared reply-to "${expected}"`,
      severity: "error",
    });
  }

  return { ok: issues.every((i) => i.severity !== "error"), issues };
}

function validatePlaceholders(config: ProductEmailConfig, payload: EmailPayload): { ok: boolean; unresolved: string[]; issues: ValidationIssue[] } {
  const unresolved = Array.from(new Set([...findUnresolvedPlaceholders(payload.subject), ...findUnresolvedPlaceholders(payload.renderedBody)]));
  const severity = config.releaseBlockingRules.requireNoUnresolvedPlaceholders ? "error" : "warning";
  const issues: ValidationIssue[] = unresolved.map((placeholder) => ({
    code: "UNRESOLVED_PLACEHOLDER",
    message: `unresolved placeholder ${placeholder} found in subject/body`,
    severity,
  }));
  return { ok: issues.every((i) => i.severity !== "error"), unresolved, issues };
}

function validateLinks(config: ProductEmailConfig, payload: EmailPayload): { ok: boolean; missing: string[]; issues: ValidationIssue[] } {
  const required = Array.from(new Set([...config.requiredFooterLinks, ...payload.requiredLinks]));
  const missing = required.filter((link) => !payload.renderedBody.includes(link));
  const severity = config.releaseBlockingRules.requireAllLinksResolve ? "error" : "warning";
  const issues: ValidationIssue[] = missing.map((link) => ({
    code: "MISSING_REQUIRED_LINK",
    message: `required link "${link}" was not found in the rendered body`,
    severity,
  }));
  return { ok: issues.every((i) => i.severity !== "error"), missing, issues };
}

const ASSET_SHAPE_PATTERN = /^(https?:\/\/[^\s]+|\/[^\s]+)$/i;

function validateAssets(config: ProductEmailConfig, payload: EmailPayload): { ok: boolean; missing: string[]; issues: ValidationIssue[] } {
  const missing: string[] = [];
  const issues: ValidationIssue[] = [];
  const severity = config.releaseBlockingRules.missingAssetSeverity;

  for (const asset of payload.requiredAssets) {
    if (!ASSET_SHAPE_PATTERN.test(asset)) {
      issues.push({ code: "ASSET_INVALID_SHAPE", message: `asset "${asset}" is not a valid absolute URL or root-relative path`, severity: "error" });
      missing.push(asset);
      continue;
    }
    if (!payload.renderedBody.includes(asset)) {
      issues.push({ code: "ASSET_MISSING", message: `required asset "${asset}" was not found referenced in the rendered body`, severity });
      missing.push(asset);
    }
  }

  return { ok: issues.every((i) => i.severity !== "error"), missing, issues };
}

function validateTemplateVars(emailType: EmailTypeDefinition | undefined, payload: EmailPayload): { ok: boolean; missing: string[]; issues: ValidationIssue[] } {
  const required = emailType?.requiredTemplateVars ?? [];
  const missing = required.filter((key) => {
    const value = payload.templateInputs[key];
    return value === undefined || value === null || value === "";
  });
  const issues: ValidationIssue[] = missing.map((key) => ({
    code: "MISSING_TEMPLATE_VAR",
    message: `required template variable "${key}" is missing or empty`,
    severity: "error",
  }));
  return { ok: issues.length === 0, missing, issues };
}

export function runEmailQaValidation(config: ProductEmailConfig, payload: EmailPayload): ValidationResult {
  const emailType = config.emailTypes.find((t) => t.id === payload.emailType);

  const issues: ValidationIssue[] = [];
  if (!emailType) {
    issues.push({
      code: "UNKNOWN_EMAIL_TYPE",
      message: `email type "${payload.emailType}" is not declared in product "${config.productId}"'s config`,
      severity: "error",
    });
  }

  const productIdentity = validateProductIdentity(config, payload);
  const sender = validateSender(config, payload);
  const replyTo = validateReplyTo(config, payload);
  const placeholders = validatePlaceholders(config, payload);
  const links = validateLinks(config, payload);
  const assets = validateAssets(config, payload);
  const templateVars = validateTemplateVars(emailType, payload);

  issues.push(...productIdentity.issues, ...sender.issues, ...replyTo.issues, ...placeholders.issues, ...links.issues, ...assets.issues, ...templateVars.issues);

  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");

  const verdict =
    errors.length > 0 ? (emailType?.releaseBlocking ? "BLOCKED" : "FAIL") : warnings.length > 0 ? "PASS_WITH_WARNINGS" : "PASS";

  return {
    ok: errors.length === 0,
    issues,
    checks: {
      productIdentity,
      sender,
      replyTo,
      placeholders,
      links,
      assets,
      templateVars,
    },
    verdict,
  };
}
