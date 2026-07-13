/**
 * Cloudflare REST client — D1 + Workers Custom Domains.
 * Credentials are constructor args (no app config coupling).
 */

export type CloudflareCredentials = {
  accountId: string;
  apiToken: string;
  /** Optional pin for a primary zone name (e.g. sites.example.com). */
  pinnedZoneId?: string;
  pinnedZoneName?: string;
};

export type WorkerDomain = {
  id: string;
  hostname: string;
  service: string;
  zone_id?: string;
  zone_name?: string;
};

interface CfResult<T> {
  success: boolean;
  errors?: { code: number; message: string }[];
  result?: T;
}

export function cloudflareConfigured(creds: Partial<CloudflareCredentials>): boolean {
  return Boolean(creds.accountId && creds.apiToken);
}

export class CloudflareClient {
  private baseUrl = "https://api.cloudflare.com/client/v4";

  constructor(private creds: CloudflareCredentials) {}

  private accountId(): string {
    return this.creds.accountId;
  }

  private apiToken(): string {
    return this.creds.apiToken;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.apiToken()}`,
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const payload = (await response.json()) as CfResult<T>;
    if (!response.ok || !payload.success) {
      const message =
        payload.errors?.map((e) => `${e.code}: ${e.message}`).join("; ") ??
        `Cloudflare request failed (${response.status})`;
      throw new Error(message);
    }
    return payload.result as T;
  }

  async createD1Database(name: string): Promise<{ uuid: string; name: string }> {
    return this.request("POST", `/accounts/${this.accountId()}/d1/database`, { name });
  }

  async resolveZoneId(zoneName: string): Promise<{ id: string; name: string } | null> {
    const pinned = this.creds.pinnedZoneId;
    const pinnedName = this.creds.pinnedZoneName;
    if (pinned && pinnedName && zoneName === pinnedName) {
      return { id: pinned, name: zoneName };
    }

    const result = await this.request<Array<{ id: string; name: string }>>(
      "GET",
      `/zones?name=${encodeURIComponent(zoneName)}&status=active&per_page=1`,
    );

    const zone = result?.[0];
    return zone ? { id: zone.id, name: zone.name } : null;
  }

  async attachWorkerDomain(input: {
    hostname: string;
    service: string;
    zoneId: string;
    zoneName: string;
  }): Promise<WorkerDomain> {
    return this.request("PUT", `/accounts/${this.accountId()}/workers/domains`, {
      hostname: input.hostname,
      service: input.service,
      environment: "production",
      zone_id: input.zoneId,
      zone_name: input.zoneName,
    });
  }

  async detachWorkerDomain(domainId: string): Promise<void> {
    await this.request("DELETE", `/accounts/${this.accountId()}/workers/domains/${domainId}`);
  }

  async findWorkerDomain(hostname: string): Promise<WorkerDomain | null> {
    const result = await this.request<WorkerDomain[]>(
      "GET",
      `/accounts/${this.accountId()}/workers/domains?hostname=${encodeURIComponent(hostname)}`,
    );
    return result?.[0] ?? null;
  }
}
