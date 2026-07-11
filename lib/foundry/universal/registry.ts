import { ProviderRegistry } from "@/lib/foundry/registry";
import {
  PROVIDER_CATEGORIES,
  normalizeCategory,
  type ProviderAction,
  type ProviderCategory,
  type ProviderManifest,
  type UniversalProvider,
} from "./types";

/**
 * Universal Provider Registry + Capability Registry.
 *
 * One registry per category, plus a flat id index. Foundry core NEVER asks for
 * a vendor by name — it asks "who can do <action> in <category>?" and the
 * selection engine picks among the answers.
 */
class UniversalProviderRegistry {
  private readonly byCategory = new Map<ProviderCategory, ProviderRegistry<UniversalProvider>>();
  private readonly byId = new Map<string, UniversalProvider>();

  constructor() {
    for (const category of PROVIDER_CATEGORIES) {
      this.byCategory.set(category, new ProviderRegistry<UniversalProvider>(category));
    }
  }

  register(provider: UniversalProvider): void {
    const category = normalizeCategory(provider.manifest.category);
    this.byCategory.get(category)!.register(provider);
    this.byId.set(provider.provider, provider);
  }

  has(providerId: string): boolean {
    return this.byId.has(providerId);
  }

  get(providerId: string): UniversalProvider {
    const provider = this.byId.get(providerId);
    if (!provider) {
      // Fail closed with the standard typed error from any category registry.
      return this.byCategory.get("repository")!.get(providerId);
    }
    return provider;
  }

  list(category?: ProviderCategory | string): string[] {
    if (category === undefined) return Array.from(this.byId.keys()).sort();
    return this.byCategory.get(normalizeCategory(category))!.list();
  }

  listProviders(category: ProviderCategory | string): UniversalProvider[] {
    return this.list(category).map((id) => this.get(id));
  }

  /** Capability routing: all providers in a category that declare an action. */
  findByCapability(category: ProviderCategory | string, action: ProviderAction): UniversalProvider[] {
    return this.listProviders(category).filter((provider) => provider.manifest.supportedCapabilities.includes(action));
  }

  manifests(): ProviderManifest[] {
    return this.list().map((id) => this.get(id).manifest);
  }

  /** Category → provider → declared actions. The Provider Capability Matrix. */
  capabilityMatrix(): Record<ProviderCategory, Array<{ provider: string; actions: ProviderAction[]; runtimeStatus: string }>> {
    const matrix = {} as Record<ProviderCategory, Array<{ provider: string; actions: ProviderAction[]; runtimeStatus: string }>>;
    for (const category of PROVIDER_CATEGORIES) {
      matrix[category] = this.listProviders(category).map((provider) => ({
        provider: provider.provider,
        actions: provider.manifest.supportedCapabilities,
        runtimeStatus: provider.manifest.runtimeStatus,
      }));
    }
    return matrix;
  }
}

// Module-scoped singleton, shared across Next.js route/module instances.
const globalRegistry = globalThis as unknown as { __foundryUniversalRegistry?: UniversalProviderRegistry };
if (!globalRegistry.__foundryUniversalRegistry) {
  globalRegistry.__foundryUniversalRegistry = new UniversalProviderRegistry();
}

export const universalRegistry: UniversalProviderRegistry = globalRegistry.__foundryUniversalRegistry;
export type { UniversalProviderRegistry };
