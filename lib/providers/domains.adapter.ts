// HTTP clients for the DNS, email, payments, and telephony domains.
// Same conventions as vercel/github adapters: injectable ProviderHTTPClient
// transport (deterministic tests), credential passed in, no secrets logged.
import { ProviderHTTPClient } from "./http-client";

export interface CloudflareDnsRecord {
  id: string;
  type: string;
  name: string;
  content: string;
}

export class CloudflareAdapter {
  private baseUrl = "https://api.cloudflare.com/client/v4";

  constructor(
    private apiToken: string,
    private client: ProviderHTTPClient = new ProviderHTTPClient()
  ) {
    if (!apiToken) throw new Error("CLOUDFLARE_API_TOKEN is required to use the Cloudflare adapter");
  }

  private headers(json = false): Record<string, string> {
    return { Authorization: `Bearer ${this.apiToken}`, ...(json ? { "Content-Type": "application/json" } : {}) };
  }

  async createDnsRecord(zoneId: string, record: { type: string; name: string; content: string; ttl?: number; proxied?: boolean }) {
    const res = await this.client.request<{ result: CloudflareDnsRecord }>(
      `${this.baseUrl}/zones/${encodeURIComponent(zoneId)}/dns_records`,
      { method: "POST", headers: this.headers(true), body: JSON.stringify({ ttl: 300, ...record }) },
      true
    );
    return res.result;
  }

  async getDnsRecord(zoneId: string, recordId: string) {
    const res = await this.client.request<{ result: CloudflareDnsRecord }>(
      `${this.baseUrl}/zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(recordId)}`,
      { method: "GET", headers: this.headers() }
    );
    return res.result;
  }

  async deleteDnsRecord(zoneId: string, recordId: string) {
    await this.client.request<{ result: { id: string } }>(
      `${this.baseUrl}/zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(recordId)}`,
      { method: "DELETE", headers: this.headers() }
    );
  }
}

export class ResendAdapter {
  private baseUrl = "https://api.resend.com";

  constructor(
    private apiKey: string,
    private client: ProviderHTTPClient = new ProviderHTTPClient()
  ) {
    if (!apiKey) throw new Error("RESEND_API_KEY is required to use the Resend adapter");
  }

  async sendEmail(message: { from: string; to: string; subject: string; text: string }) {
    return this.client.request<{ id: string }>(
      `${this.baseUrl}/emails`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(message),
      },
      true
    );
  }
}

export class StripeAdapter {
  private baseUrl = "https://api.stripe.com/v1";

  constructor(
    private secretKey: string,
    private client: ProviderHTTPClient = new ProviderHTTPClient()
  ) {
    if (!secretKey) throw new Error("STRIPE_SECRET_KEY is required to use the Stripe adapter");
  }

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.secretKey}`, "Content-Type": "application/x-www-form-urlencoded" };
  }

  async createProduct(config: { name: string; description?: string }) {
    const body = new URLSearchParams({ name: config.name, ...(config.description ? { description: config.description } : {}) });
    return this.client.request<{ id: string; name: string; active: boolean }>(
      `${this.baseUrl}/products`,
      { method: "POST", headers: this.headers(), body: body.toString() },
      true
    );
  }

  async getProduct(productId: string) {
    return this.client.request<{ id: string; name: string; active: boolean }>(
      `${this.baseUrl}/products/${encodeURIComponent(productId)}`,
      { method: "GET", headers: this.headers() }
    );
  }

  /** Compensation: Stripe products with no prices can be deleted; otherwise archive. */
  async archiveProduct(productId: string) {
    const body = new URLSearchParams({ active: "false" });
    return this.client.request<{ id: string; active: boolean }>(
      `${this.baseUrl}/products/${encodeURIComponent(productId)}`,
      { method: "POST", headers: this.headers(), body: body.toString() }
    );
  }
}

export class SignalWireAdapter {
  constructor(
    private spaceUrl: string,
    private projectId: string,
    private apiToken: string,
    private client: ProviderHTTPClient = new ProviderHTTPClient()
  ) {
    if (!spaceUrl || !projectId || !apiToken) {
      throw new Error("SIGNALWIRE_SPACE_URL, SIGNALWIRE_PROJECT_ID and SIGNALWIRE_API_TOKEN are required to use the SignalWire adapter");
    }
  }

  async sendSms(message: { from: string; to: string; body: string }) {
    const auth = Buffer.from(`${this.projectId}:${this.apiToken}`).toString("base64");
    const body = new URLSearchParams({ From: message.from, To: message.to, Body: message.body });
    return this.client.request<{ sid: string; status: string }>(
      `https://${this.spaceUrl}/api/laml/2010-04-01/Accounts/${encodeURIComponent(this.projectId)}/Messages.json`,
      {
        method: "POST",
        headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      },
      true
    );
  }
}
