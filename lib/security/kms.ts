import crypto from "crypto";

// Envelope encryption: a per-org data-encryption key (DEK) encrypts secrets;
// the KMS provider wraps the DEK. The original scaffold shipped a passthrough
// "AWSKMSProvider" that returned keys unencrypted — that stub is deliberately
// gone. LocalKMSProvider does real AES-256-GCM wrapping under a master key.

export interface IKMSProvider {
  wrap(dataKey: Buffer): Promise<Buffer>;
  unwrap(wrappedKey: Buffer): Promise<Buffer>;
}

export class LocalKMSProvider implements IKMSProvider {
  private masterKey: Buffer;

  constructor(masterKeyHex = process.env.FOUNDRY_MASTER_KEY) {
    if (!masterKeyHex || !/^[0-9a-fA-F]{64}$/.test(masterKeyHex)) {
      throw new Error(
        "FOUNDRY_MASTER_KEY must be set to 64 hex chars (32 bytes). " +
          'Generate one: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
      );
    }
    this.masterKey = Buffer.from(masterKeyHex, "hex");
  }

  async wrap(dataKey: Buffer): Promise<Buffer> {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", this.masterKey, iv);
    const encrypted = Buffer.concat([cipher.update(dataKey), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
  }

  async unwrap(wrappedKey: Buffer): Promise<Buffer> {
    const iv = wrappedKey.subarray(0, 12);
    const tag = wrappedKey.subarray(12, 28);
    const encrypted = wrappedKey.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", this.masterKey, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
  }
}

export interface EncryptedSecret {
  iv: string;
  content: string;
  tag: string;
  wrappedDek: string;
}

export class SecretsService {
  constructor(private kms: IKMSProvider) {}

  async encryptSecret(plaintext: string): Promise<EncryptedSecret> {
    const dek = crypto.randomBytes(32);
    const wrappedDek = await this.kms.wrap(dek);

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", dek, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);

    return {
      iv: iv.toString("hex"),
      content: encrypted.toString("hex"),
      tag: cipher.getAuthTag().toString("hex"),
      wrappedDek: wrappedDek.toString("base64"),
    };
  }

  async decryptSecret(secret: EncryptedSecret): Promise<string> {
    const dek = await this.kms.unwrap(Buffer.from(secret.wrappedDek, "base64"));
    const decipher = crypto.createDecipheriv("aes-256-gcm", dek, Buffer.from(secret.iv, "hex"));
    decipher.setAuthTag(Buffer.from(secret.tag, "hex"));
    return Buffer.concat([
      decipher.update(Buffer.from(secret.content, "hex")),
      decipher.final(),
    ]).toString("utf8");
  }
}
