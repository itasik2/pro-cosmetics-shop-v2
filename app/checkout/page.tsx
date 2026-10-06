// app/checkout/page.tsx
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "default-no-store";

import { getStorePolicy } from "@/lib/storePolicy";
import CheckoutClient from "./CheckoutClient";

export default function Page() {
  const { deliveryPrice, deliveryTerms } = getStorePolicy();
  return <CheckoutClient deliveryPrice={deliveryPrice} deliveryTerms={deliveryTerms} />;
}
