import { randomUUID } from "crypto";

export class ProviderError extends Error {
  constructor(message: string, public statusCode: number, public body: unknown) {
    super(message);
    this.name = "ProviderError";
  }
}

export class ProviderHTTPClient {
  private retryConfig = { maxRetries: 4, baseDelayMs: 1000, maxDelayMs: 10000 };

  async request<T>(url: string, options: RequestInit = {}, idempotent = false): Promise<T> {
    let attempt = 0;
    while (true) {
      try {
        const headers = new Headers(options.headers);
        if (idempotent && !headers.has("Idempotency-Key")) {
          headers.set("Idempotency-Key", randomUUID());
        }
        const response = await fetch(url, { ...options, headers });

        if (response.status === 429 || response.status >= 500) {
          if (attempt >= this.retryConfig.maxRetries) {
            throw new ProviderError("Max retries exceeded", response.status, await response.text());
          }
          const retryAfter = response.headers.get("Retry-After");
          const delay = retryAfter ? parseInt(retryAfter, 10) * 1000 : this.calculateBackoff(attempt);
          await this.sleep(delay);
          attempt++;
          continue;
        }

        if (!response.ok) {
          const errorBody = await response.json().catch(() => ({}));
          throw new ProviderError(`Provider API error: ${response.status} ${response.statusText}`, response.status, errorBody);
        }
        if (response.status === 204) return undefined as T;
        return (await response.json()) as T;
      } catch (error) {
        if (error instanceof ProviderError) throw error;
        if (attempt >= this.retryConfig.maxRetries) throw error;
        await this.sleep(this.calculateBackoff(attempt));
        attempt++;
      }
    }
  }

  private calculateBackoff(attempt: number): number {
    const delay = Math.min(this.retryConfig.maxDelayMs, this.retryConfig.baseDelayMs * Math.pow(2, attempt));
    return delay + Math.random() * 500;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
