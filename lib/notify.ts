import { isHalykEpayConfigured } from "@/lib/halykEpay";
import { getMailConfigurationStatus, sendSiteMail } from "@/lib/mailer";
import { getPaymentInstructions } from "@/lib/paymentInstructions";
import { getPublicBaseUrl } from "@/lib/siteConfig";

type OrderMailItem = {
  title: string;
  qty: number;
  lineTotal: number;
  sku?: string | null;
};

export type NotifyArgs = {
  orderId: string;
  orderNumber: string;
  totalAmount: number;
  customerName: string;
  phone: string;
  customerEmail?: string | null;
  notificationChannel?: string | null;
  notificationContact?: string | null;
  deliveryType: string;
  address?: string | null;
  comment?: string | null;
  paymentMethod?: string | null;
  items: OrderMailItem[];
  orderAccessUrl?: string | null;
  paymentDueAt?: Date | string | null;
};

type PaymentReportArgs = NotifyArgs & {
  paymentNote?: string | null;
};

function deliveryLabel(value: string) {
  return value === "delivery" ? "Доставка" : "Самовывоз";
}

function paymentMethodLabel(value?: string | null) {
  if (value === "HALYK_EPAY") return "Банковская карта через Halyk ePay";
  if (value === "KASPI_TRANSFER") return "Предоплата: Halyk ePay / перевод на Kaspi";
  return "Оплата при получении";
}

function notificationChannelLabel(value?: string | null) {
  if (value === "WHATSAPP") return "WhatsApp";
  if (value === "TELEGRAM") return "Telegram";
  if (value === "EMAIL") return "Email";
  return value || null;
}

function itemLines(items: OrderMailItem[]) {
  return items.map(
    (item, index) =>
      `${index + 1}. ${item.title}${item.sku ? ` • SKU ${item.sku}` : ""} — ${item.qty} шт. • ${item.lineTotal.toLocaleString("ru-RU")} ₸`,
  );
}

function commonOrderLines(args: NotifyArgs) {
  const contactLabel = notificationChannelLabel(args.notificationChannel);
  return [
    `Заказ ${args.orderNumber}`,
    "",
    `Сумма: ${args.totalAmount.toLocaleString("ru-RU")} ₸`,
    `Клиент: ${args.customerName}`,
    `Телефон: ${args.phone}`,
    args.customerEmail ? `Email: ${args.customerEmail}` : null,
    contactLabel ? `Канал связи: ${contactLabel}` : null,
    args.notificationContact ? `Контакт для уведомлений: ${args.notificationContact}` : null,
    `Получение: ${deliveryLabel(args.deliveryType)}`,
    args.address ? `Адрес: ${args.address}` : null,
    args.comment ? `Комментарий: ${args.comment}` : null,
    args.paymentMethod ? `Способ оплаты: ${paymentMethodLabel(args.paymentMethod)}` : null,
    "",
    "Состав заказа:",
    ...itemLines(args.items),
  ].filter(Boolean) as string[];
}

function formatDueDate(value?: Date | string | null) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime())
    ? null
    : date.toLocaleString("ru-RU", { timeZone: "Asia/Almaty" });
}

function paymentInstructionLines(args: NotifyArgs) {
  const instructions = getPaymentInstructions();
  const halykAvailable = isHalykEpayConfigured();
  return [
    halykAvailable
      ? "Оплата картой: откройте персональную страницу заказа и нажмите «Оплатить картой» в блоке Halyk ePay. Подтверждение оплаты происходит автоматически."
      : null,
    instructions.hasInstructions
      ? halykAvailable
        ? "Альтернативный способ — перевод на Kaspi:"
        : "Реквизиты для оплаты:"
      : null,
    instructions.recipientName ? `Получатель: ${instructions.recipientName}` : null,
    instructions.kaspiPhone ? `Kaspi: ${instructions.kaspiPhone}` : null,
    instructions.paymentLink ? `Ссылка на оплату: ${instructions.paymentLink}` : null,
    instructions.note || null,
    !halykAvailable && !instructions.hasInstructions
      ? "Реквизиты ещё не настроены — менеджер отправит их отдельно."
      : null,
    formatDueDate(args.paymentDueAt) ? `Оплатить до: ${formatDueDate(args.paymentDueAt)}` : null,
    "",
    args.orderAccessUrl
      ? `Открыть страницу заказа: ${args.orderAccessUrl}`
      : "Откройте персональную ссылку на заказ из письма о его оформлении.",
    instructions.hasInstructions
      ? "Если оплатили переводом на Kaspi, нажмите на странице заказа «Я оплатил»."
      : null,
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
    replyTo: args.customerEmail || undefined,
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
  const halykAvailable = isHalykEpayConfigured();
  const lines = [
    `Здравствуйте, ${args.customerName}!`,
    "",
    halykAvailable
      ? "Мы получили ваш заказ. Ожидать подтверждения менеджера не нужно: перейдите к оплате через Halyk ePay."
      : "Мы получили ваш заказ. Оплатить его можно сразу на персональной странице заказа.",
    "",
    ...commonOrderLines(args),
    "",
    "Статус оплаты: Ожидает оплаты",
    args.orderAccessUrl ? `Персональная страница заказа: ${args.orderAccessUrl}` : null,
    "",
    "Если вы не оформляли этот заказ, ответьте на это письмо.",
  ].filter(Boolean) as string[];

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

export async function notifyCustomerPaymentRequired(args: NotifyArgs) {
  const recipient = args.customerEmail?.trim();
  if (!recipient) {
    return { status: "skipped", provider: "none", reason: "not_configured" } as const;
  }

  const subject = `Оплата заказа ${args.orderNumber}`;
  const lines = [
    `Здравствуйте, ${args.customerName}!`,
    "",
    `Заказ ${args.orderNumber} подтверждён. Для запуска сборки оплатите ${args.totalAmount.toLocaleString("ru-RU")} ₸.`,
    "",
    ...paymentInstructionLines(args),
    "",
    isHalykEpayConfigured()
      ? "Оплата картой через Halyk ePay подтверждается автоматически. Перевод на Kaspi проверяет менеджер."
      : "После ручной проверки менеджер переведёт заказ в сборку.",
  ];

  const result = await sendSiteMail({
    to: recipient,
    replyTo: getMailConfigurationStatus().recipient,
    subject,
    text: lines.join("\n"),
  });

  if (result.status !== "sent") {
    console.error("[notify] Payment instructions email was not delivered:", {
      orderNumber: args.orderNumber,
      recipient,
      status: result.status,
      reason: result.reason,
    });
  }

  return result;
}

export async function notifyAdminPaymentReported(args: PaymentReportArgs) {
  const subject = `Клиент сообщил об оплате заказа ${args.orderNumber}`;
  const lines = [
    subject,
    "",
    ...commonOrderLines(args),
    "",
    args.paymentNote ? `Комментарий клиента: ${args.paymentNote}` : "Комментарий клиента: —",
    args.orderAccessUrl ? `Страница заказа клиента: ${args.orderAccessUrl}` : null,
    `Открыть в админке: ${getPublicBaseUrl()}/admin/orders/${args.orderId}`,
  ].filter(Boolean) as string[];

  const result = await sendSiteMail({
    subject,
    text: lines.join("\n"),
    replyTo: args.customerEmail || undefined,
  });

  if (result.status !== "sent") {
    console.error("[notify] Payment report email was not delivered:", {
      orderNumber: args.orderNumber,
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
    args.paymentMethod === "HALYK_EPAY"
      ? "Платёж подтверждён системой Halyk ePay."
      : "Это подтверждение оплаты от магазина. Фискальный чек будет доступен после подключения онлайн-кассы или платёжного провайдера.",
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
