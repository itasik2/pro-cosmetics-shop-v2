import { getScopedEnv, SITE_KEY } from "./siteConfig";

const DEFAULT_SELLER_NAME_BY_SITE: Record<string, string> = {
  procosmetics: 'ИП "Мир услуг"',
};

export function configuredDeliveryPrice(value: string) {
  if (!/^\d+$/.test(value.trim())) return null;
  const price = Number(value);
  return Number.isSafeInteger(price) && price <= 1_000_000 ? price : null;
}

export function getStorePolicy() {
  return {
    sellerName:
      getScopedEnv("STORE_SELLER_NAME").trim() ||
      DEFAULT_SELLER_NAME_BY_SITE[SITE_KEY] ||
      "",
    sellerId: getScopedEnv("STORE_SELLER_ID").trim(),
    sellerAddress: getScopedEnv("STORE_SELLER_ADDRESS").trim(),
    deliveryPrice: configuredDeliveryPrice(getScopedEnv("STORE_DELIVERY_PRICE")),
    deliveryTerms: getScopedEnv("STORE_DELIVERY_TERMS").trim() || "Стоимость и сроки доставки зависят от адреса. Уточните их у магазина до оплаты заказа.",
    returnsTerms: getScopedEnv("STORE_RETURNS_TERMS").trim(),
  };
}
