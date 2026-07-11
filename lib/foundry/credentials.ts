import { LocalKMSProvider, SecretsService } from "@/lib/security/kms";
import { createCredentialRecord, getStoreSnapshot, insertRecord } from "./store";
import type { ProviderCredentialReferenceRecord, ProviderKind } from "./types";

export function getSecretsService() {
  return new SecretsService(new LocalKMSProvider());
}

export async function upsertProviderCredential(input: {
  orgId: string;
  projectId?: string;
  provider: ProviderKind;
  purpose: string;
  plaintextSecret: string;
}): Promise<ProviderCredentialReferenceRecord> {
  const existing = (await getStoreSnapshot()).credentials.find(
    (credential) =>
      credential.orgId === input.orgId &&
      credential.projectId === input.projectId &&
      credential.provider === input.provider &&
      credential.purpose === input.purpose
  );
  if (existing) return existing;

  const encryptedSecret = await getSecretsService().encryptSecret(input.plaintextSecret);
  const record = createCredentialRecord({
    orgId: input.orgId,
    projectId: input.projectId,
    provider: input.provider,
    purpose: input.purpose,
    encryptedSecret,
    keyVersion: 1,
  });
  await insertRecord("credentials", record);
  return record;
}

export async function resolveCredentialValue(credentialId: string) {
  const credential = (await getStoreSnapshot()).credentials.find((item) => item.id === credentialId);
  if (!credential) throw new Error(`Missing credential ${credentialId}`);
  return getSecretsService().decryptSecret(credential.encryptedSecret);
}
