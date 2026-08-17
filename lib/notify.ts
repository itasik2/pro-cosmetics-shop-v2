import { sendSiteMail } from "@/lib/mailer";
import { getPublicBaseUrl } from "@/lib/siteConfig";

type NotifyArgs = {
  orderId: string;
  orderNumber: string;
  totalAmount: number;
  customerName: string;
  phone: string;
  customerEmail?: string | null;
  deliveryType: string;
  address?: string | null;
  comment?: string | null;
  items: Array<{
    title: string;
    qty: number;
    lineTotal: number;
    sku?: string | null;
  }>;
};

export async function notifyAdminNewOrder(args: NotifyArgs) {
  const subject = `Новый заказ ${args.orderNumber} • ${args.totalAmount.toLocaleString("ru-RU")} ₸`;
  const deliveryLabel =
    args.deliveryType === "delivery" ? "Доставка" : "Самовывоз";

  const lines = [
    `Новый заказ ${args.orderNumber}`,
    "",
    `Сумма: ${args.totalAmount.toLocaleString("ru-RU")} ₸`,
    `Клиент: ${args.customerName}`,
    `Телефон: ${args.phone}`,
    args.customerEmail ? `Email: ${args.customerEmail}` : null,
    `Получение: ${deliveryLabel}`,
    args.address ? `Адрес: ${args.address}` : null,
    args.comment ? `Комментарий: ${args.comment}` : null,
    "",
    "Состав заказа:",
    ...args.items.map(
      (item, index) =>
        `${index + 1}. ${item.title}${item.sku ? ` • SKU ${item.sku}` : ""} — ${item.qty} шт. • ${item.lineTotal.toLocaleString("ru-RU")} ₸`,
    ),
    "",
    `Открыть заказ: ${getPublicBaseUrl()}/admin/orders/${args.orderId}`,
  ].filter(Boolean);

  const result = await sendSiteMail({
    subject,
    text: lines.join("\n"),
    replyTo: args.customerEmail,
  });

  if (result.status !== "sent") {
    console.error("[notify] New order email was not delivered:", {
      orderNumber: args.orderNumber,
      status: result.status,
      reason: result.reason,
    });
  }

  return result;
}
