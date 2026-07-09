import crypto from "crypto";

export function generateApiKey() {
  const plainKey = `pf_live_${crypto.randomBytes(32).toString("hex")}`;
  return {
    plainKey,
    prefix: plainKey.substring(0, 12),
    hashedKey: crypto.createHash("sha256").update(plainKey).digest("hex"),
  };
}

export function hashApiKey(plainKey: string) {
  return crypto.createHash("sha256").update(plainKey).digest("hex");
}
