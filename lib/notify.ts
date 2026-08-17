import { getMailConfigurationStatus, sendSiteMail } from "@/lib/mailer";
import { getPublicBaseUrl } from "@/lib/siteConfig";

type OrderMailItem = {
  title: string;
  qty: number;
  lineTotal: number;
  sku?: string | null;
};

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
  paymentMethod?: string | null;
  items: OrderMailItem[];
};

function deliveryLabel(value: string) {
  return value === "delivery" ? "Доставка" : "Самовывоз";
}

function paymentMethodLabel(value?: string | null) {
  return value === "KASPI_TRANSFER" ? "Перевод на Kaspi" : "Оплата при получении";
}

function itemLines(items: OrderMailItem[]) {
  return items.map(
    (item, index) =>
      `${index + 1}. ${item.title}${item.sku ? ` • SKU ${item.sku}` : ""} — ${item.qty} шт. • ${item.lineTotal.toLocaleString("ru-RU")} ₸`,
  );
}

function commonOrderLines(args: NotifyArgs) {
  return [
    `Заказ ${args.orderNumber}`,
    "",
    `Сумма: ${args.totalAmount.toLocaleString("ru-RU")} ₸`,
    `Клиент: ${args.customerName}`,
    `Телефон: ${args.phone}`,
    args.customerEmail ? `Email: ${args.customerEmail}` : null,
    `Получение: ${deliveryLabel(args.deliveryType)}`,
    args.address ? `Адрес: ${args.address}` : null,
    args.comment ? `Комментарий: ${args.comment}` : null,
    args.paymentMethod ? `Способ оплаты: ${paymentMethodLabel(args.paymentMethod)}` : null,
    "",
    "Состав заказа:",
    ...itemLines(args.items),
  ].filter(Boolean) as string[];
}

export async function notifyAdminNewOrder(args: NotifyArgs) {
  const subject = `Новый заказ ${args.orderNumber} • ${args.totalAmount.toLocaleString("ru-RU")} ₸`;
  const lines = [
    subject,
    "",
    ...commonOrderLines(args).slice(2),
    "",
    `Открыть заказ: ${getPublicBaseUrl()}/admin/orders/${args.orderId}`,
  ];

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

export async function notifyCustomerOrderCreated(args: NotifyArgs) {
  const recipient = args.customerEmail?.trim();
  if (!recipient) {
    return { status: "skipped", provider: "none", reason: "not_configured" } as const;
  }

  const subject = `Заказ ${args.orderNumber} принят`;
  const lines = [
    `Здравствуйте, ${args.customerName}!`,
    "",
    "Мы получили ваш заказ и свяжемся с вами для подтверждения.",
    "",
    ...commonOrderLines(args),
    "",
    "Статус оплаты: Не оплачен",
    "",
    "Если вы не оформляли этот заказ, ответьте на это письмо.",
  ];

  const result = await sendSiteMail({
    to: recipient,
    replyTo: getMailConfigurationStatus().recipient,
    subject,
    text: lines.join("\n"),
  });

  if (result.status !== "sent") {
    console.error("[notify] Customer order email was not delivered:", {
      orderNumber: args.orderNumber,
      recipient,
      status: result.status,
      reason: result.reason,
    });
  }

  return result;
}

export async function notifyCustomerPaymentReceipt(args: NotifyArgs) {
  const recipient = args.customerEmail?.trim();
  if (!recipient) {
    return { status: "skipped", provider: "none", reason: "not_configured" } as const;
  }

  const subject = `Оплата заказа ${args.orderNumber} подтверждена`;
  const lines = [
    `Здравствуйте, ${args.customerName}!`,
    "",
    `Оплата заказа ${args.orderNumber} на сумму ${args.totalAmount.toLocaleString("ru-RU")} ₸ подтверждена.`,
    "",
    ...commonOrderLines(args),
    "",
    "Это подтверждение оплаты от магазина. Фискальный чек будет доступен после подключения онлайн-кассы или платёжного провайдера.",
  ];

  const result = await sendSiteMail({
    to: recipient,
    replyTo: getMailConfigurationStatus().recipient,
    subject,
    text: lines.join("\n"),
  });

  if (result.status !== "sent") {
    console.error("[notify] Customer payment receipt was not delivered:", {
      orderNumber: args.orderNumber,
      recipient,
      status: result.status,
      reason: result.reason,
    });
  }

  return result;
}
