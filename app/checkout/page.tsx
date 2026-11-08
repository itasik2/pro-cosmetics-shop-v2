// app/checkout/page.tsx
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "default-no-store";

import { getStorePolicy } from "@/lib/storePolicy";
import { getCustomerMessengerAvailability } from "@/lib/messenger";
import CheckoutClient from "./CheckoutClient";
import { requestLocale } from "@/lib/i18nServer";
import { uiText } from "@/lib/i18n";

export default async function Page() {
  const locale = await requestLocale();
  const { deliveryPrice, deliveryTerms } = getStorePolicy();
  return <CheckoutClient deliveryPrice={deliveryPrice} deliveryTerms={uiText(locale, deliveryTerms)} messengerAvailability={getCustomerMessengerAvailability()} />;
}
