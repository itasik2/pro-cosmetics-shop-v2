/**
 * Do not confuse a refunded payment with a settled payment. Refunds remove
 * permission to pack, ship, or complete an order regardless of payment method.
 *
 * Cash-on-delivery orders can be packed and shipped before payment, but may
 * only be completed after the payment is actually marked PAID.
 */
export function isOrderFulfillmentAllowed(args: {
  paymentMethod: string;
  paymentStatus: string;
  orderStatus: string;
}): boolean {
  const { paymentMethod, paymentStatus, orderStatus } = args;

  const isFulfillmentStep = ["PACKING", "SHIPPED", "DONE"].includes(orderStatus);
  if (!isFulfillmentStep) return true;

  if (paymentStatus === "REFUNDED") return false;
  if (orderStatus === "DONE") return paymentStatus === "PAID";

  if (paymentMethod === "KASPI_TRANSFER") {
    return paymentStatus === "PAID";
  }

  return true;
}
