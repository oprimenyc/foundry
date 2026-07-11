export class UnknownProviderError extends Error {
  constructor(public readonly capability: string, public readonly providerId: string) {
    super(`Unknown ${capability} provider: "${providerId}"`);
    this.name = "UnknownProviderError";
  }
}

export class DuplicateProviderError extends Error {
  constructor(public readonly capability: string, public readonly providerId: string) {
    super(`${capability} provider "${providerId}" is already registered`);
    this.name = "DuplicateProviderError";
  }
}

/**
 * Generic capability registry. Foundry code asks a registry for an adapter by
 * providerId and never branches on provider name — new providers register
 * themselves via `.register()` without any change to core execution/validation code.
 */
export class ProviderRegistry<TAdapter extends { provider: string }> {
  private readonly adapters = new Map<string, TAdapter>();

  constructor(private readonly capability: string) {}

  register(adapter: TAdapter): void {
    if (this.adapters.has(adapter.provider)) {
      throw new DuplicateProviderError(this.capability, adapter.provider);
    }
    this.adapters.set(adapter.provider, adapter);
  }

  /** Fails closed: throws for any providerId not explicitly registered. */
  get(providerId: string): TAdapter {
    const adapter = this.adapters.get(providerId);
    if (!adapter) throw new UnknownProviderError(this.capability, providerId);
    return adapter;
  }

  has(providerId: string): boolean {
    return this.adapters.has(providerId);
  }

  /** Deterministic (sorted) provider id listing, for UI/API population. */
  list(): string[] {
    return Array.from(this.adapters.keys()).sort();
  }
}
