import type {
  MarketplaceCapabilities,
  MarketplaceConnector,
} from "../domain/marketplace.js";

type KaspiConnectorOptions = {
  token: string;
  baseUrl?: string;
};

export const kaspiCapabilities: MarketplaceCapabilities = {
  catalog: {
    categories: "API",
    attributes: "API",
    cardCreate: "API",
    cardUpdate: "UNKNOWN",
    publicationStatus: "API",
  },
  offer: {
    // Public Seller API documentation does not expose direct per-offer
    // mutation endpoints for these operations. Keep the transport explicit.
    price: "PRICE_FEED",
    stock: "PRICE_FEED",
    preorder: "PRICE_FEED",
    warehouses: "API",
  },
  orders: {
    read: "API",
    updateStatus: "API",
  },
};

export class KaspiConnector implements MarketplaceConnector {
  readonly code = "KASPI" as const;
  readonly capabilities = kaspiCapabilities;

  private readonly token: string;
  private readonly baseUrl: string;

  constructor(options: KaspiConnectorOptions) {
    if (!options.token.trim()) {
      throw new Error("Kaspi API token is required");
    }

    this.token = options.token.trim();
    this.baseUrl = (options.baseUrl ?? "https://kaspi.kz").replace(/\/$/, "");
  }

  async health() {
    try {
      await this.getImportSchema();
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Unknown Kaspi error",
      };
    }
  }

  async getCategories(): Promise<unknown> {
    return this.get("/shop/api/products/classification/categories");
  }

  async getImportSchema(): Promise<unknown> {
    return this.get("/shop/api/products/import/schema");
  }

  async getImportStatus(importCode: string): Promise<unknown> {
    const code = encodeURIComponent(importCode);
    return this.get(`/shop/api/products/import?i=${code}`);
  }

  async getOrders(params?: {
    page?: number;
    size?: number;
    state?: string;
    status?: string;
  }): Promise<unknown> {
    const query = new URLSearchParams();
    query.set("page[number]", String(params?.page ?? 0));
    query.set("page[size]", String(Math.min(Math.max(params?.size ?? 20, 1), 100)));

    if (params?.state) query.set("filter[orders][state]", params.state);
    if (params?.status) query.set("filter[orders][status]", params.status);

    return this.get(`/shop/api/v2/orders?${query.toString()}`, {
      Accept: "application/vnd.api+json",
    });
  }

  async getOrderEntries(orderId: string): Promise<unknown> {
    return this.get(
      `/shop/api/v2/orders/${encodeURIComponent(orderId)}/entries`,
      { Accept: "application/vnd.api+json" },
    );
  }

  private async get(path: string, extraHeaders: Record<string, string> = {}) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "X-Auth-Token": this.token,
        ...extraHeaders,
      },
      signal: AbortSignal.timeout(20_000),
    });

    const body = await response.text();

    if (!response.ok) {
      throw new Error(
        `Kaspi ${response.status} ${response.statusText}: ${body.slice(0, 500)}`,
      );
    }

    if (!body) return null;

    try {
      return JSON.parse(body);
    } catch {
      return body;
    }
  }
}
