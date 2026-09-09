export type ShippingProviderCode = "QAZPOST" | "CDEK";

export type ShippingAddress = {
  address: string;
  postcode?: string | null;
  city?: string | null;
  countryCode?: string | null;
  providerLocationCode?: string | null;
};

export type ShippingPackage = {
  weightGrams: number;
  lengthMm?: number | null;
  widthMm?: number | null;
  heightMm?: number | null;
};

export type ShippingQuoteRequest = {
  orderId?: string | null;
  from: ShippingAddress;
  to: ShippingAddress;
  packages: ShippingPackage[];
  declaredValueKzt?: number | null;
  pickupPointCode?: string | null;
};

export type ShippingQuote = {
  provider: ShippingProviderCode;
  serviceCode: string;
  serviceName: string;
  priceKzt: number;
  estimatedDaysMin?: number | null;
  estimatedDaysMax?: number | null;
  pickupPointCode?: string | null;
  raw?: unknown;
};

export type CreateShipmentRequest = ShippingQuoteRequest & {
  orderId: string;
  orderNumber: string;
  serviceCode: string;
  recipient: {
    name: string;
    phone: string;
    email?: string | null;
  };
};

export type CreatedShipment = {
  provider: ShippingProviderCode;
  externalId: string;
  trackingNumber?: string | null;
  labelUrl?: string | null;
  providerStatus?: string | null;
  raw?: unknown;
};

export type ShippingTrackingResult = {
  provider: ShippingProviderCode;
  trackingNumber: string;
  providerStatus: string;
  normalizedStatus:
    | "CREATED"
    | "SHIPPED"
    | "IN_TRANSIT"
    | "DELIVERED"
    | "CANCELED"
    | "ERROR";
  occurredAt?: Date | null;
  raw?: unknown;
};

export type ShippingProviderCapabilities = {
  addressSearch: boolean;
  quote: boolean;
  createShipment: boolean;
  cancelShipment: boolean;
  label: boolean;
  tracking: boolean;
  pickupPoints: boolean;
  courierPickup: boolean;
};

export interface ShippingProviderClient {
  readonly code: ShippingProviderCode;
  readonly capabilities: ShippingProviderCapabilities;

  quote?(request: ShippingQuoteRequest): Promise<ShippingQuote[]>;
  createShipment?(request: CreateShipmentRequest): Promise<CreatedShipment>;
  cancelShipment?(externalId: string): Promise<void>;
  track?(trackingNumber: string): Promise<ShippingTrackingResult>;
}
