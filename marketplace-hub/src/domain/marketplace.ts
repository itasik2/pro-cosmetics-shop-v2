export type MarketplaceCode = "KASPI" | "WILDBERRIES" | "OZON";

export type CapabilityMode =
  | "API"
  | "PRICE_FEED"
  | "ACCOUNT_CONNECTOR"
  | "UNSUPPORTED"
  | "UNKNOWN";

export type MarketplaceCapabilities = {
  catalog: {
    categories: CapabilityMode;
    attributes: CapabilityMode;
    cardCreate: CapabilityMode;
    cardUpdate: CapabilityMode;
    publicationStatus: CapabilityMode;
  };
  offer: {
    price: CapabilityMode;
    stock: CapabilityMode;
    preorder: CapabilityMode;
    warehouses: CapabilityMode;
  };
  orders: {
    read: CapabilityMode;
    updateStatus: CapabilityMode;
  };
};

export type MarketplaceConnector = {
  code: MarketplaceCode;
  capabilities: MarketplaceCapabilities;
  health(): Promise<{ ok: boolean; message?: string }>;
};
