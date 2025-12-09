// app/checkout/page.tsx
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "default-no-store";

import CheckoutClient from "./CheckoutClient";

export default function Page() {
  return <CheckoutClient />;
}
