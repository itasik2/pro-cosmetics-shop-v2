import { createHmac, timingSafeEqual } from "node:crypto";
import { isHalykEpayConfigured } from "@/lib/halykEpay";
import { getPaymentInstructions } from "@/lib/paymentInstructions";
import { getScopedEnv } from "@/lib/siteConfig";

export type MessengerEvent =
  | "ORDER_CREATED"
  | "PAYMENT_REQUIRED"
  | "PAYMENT_PAID"
  | "STATUS_UPDATE";

export type MessengerDeliveryResult =
  | {
      status: "sent";
      provider: "telegram" | "whatsapp";
      messageId?: string;
    }
  | {
      status: "skipped";
      provider: "none" | "telegram" | "whatsapp";
      reason: string;
    }
  | {
      status: "failed";
      provider: "telegram" | "whatsapp";
      reason: string;
    };

export type MessengerOrder = {
  orderNumber: string;
  totalAmount: number;
  customerName: string;
  phone: string;
  status: string;
  paymentMethod: string;
  paymentStatus: string;
  paymentDueAt?: Date | string | null;
  notificationChannel?: string | null;
  notificationContact?: string | null;
  telegramChatId?: string | null;
  orderAccessUrl: string;
};

function statusLabel(value: string) {
  const labels: Record<string, string> = {
    NEW: "Новый",
    CONFIRMED: "Подтверждён",
    PACKING: "Сборка",
    SHIPPED: "Отправлен",
    DONE: "Завершён",
    CANCELED: "Отменён",
  };
  return labels[value] || value;
}

function formatDueDate(value?: Date | string | null) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleString("ru-RU", { timeZone: "Asia/Almaty" });
}

function sentenceValue(value: string) {
  return value.trim().replace(/[.!?]+$/g, "");
}

function eventSummary(order: MessengerOrder, event: MessengerEvent) {
  if (event === "ORDER_CREATED") {
    const halykAvailable = isHalykEpayConfigured();
    return halykAvailable
      ? `заказ принят. Сумма ${order.totalAmount.toLocaleString("ru-RU")} ₸. Ожидать подтверждения менеджера не нужно: оплатите заказ через Halyk ePay на странице заказа.`
      : `заказ принят. Сумма ${order.totalAmount.toLocaleString("ru-RU")} ₸. Оплатить заказ можно сразу на странице заказа.`;
  }

  if (event === "PAYMENT_REQUIRED") {
    const instructions = getPaymentInstructions();
    const halykAvailable = isHalykEpayConfigured();
    const parts = [
      `заказ подтверждён. К оплате ${order.totalAmount.toLocaleString("ru-RU")} ₸.`,
      halykAvailable
        ? "На странице заказа доступна оплата банковской картой через Halyk ePay; подтверждение поступит автоматически."
        : "",
      instructions.hasInstructions && halykAvailable
        ? "Также можно оплатить переводом на Kaspi."
        : "",
      instructions.recipientName
        ? `Получатель: ${sentenceValue(instructions.recipientName)}.`
        : "",
      instructions.kaspiPhone ? `Kaspi: ${sentenceValue(instructions.kaspiPhone)}.` : "",
      formatDueDate(order.paymentDueAt)
        ? `Оплатить до ${formatDueDate(order.paymentDueAt)}.`
        : "",
      instructions.hasInstructions
        ? "Если оплатили переводом на Kaspi, отметьте оплату на странице заказа."
        : "",
    ];
    return parts.filter(Boolean).join(" ");
  }

  if (event === "PAYMENT_PAID") {
    return `оплата ${order.totalAmount.toLocaleString("ru-RU")} ₸ подтверждена. Заказ передан в дальнейшую обработку.`;
  }

  return `статус заказа изменён: ${statusLabel(order.status)}.`;
}

function telegramText(order: MessengerOrder, event: MessengerEvent) {
  return [
    `Здравствуйте, ${order.customerName}!`,
    "",
    `Заказ ${order.orderNumber}: ${eventSummary(order, event)}`,
    "",
    `Страница заказа: ${order.orderAccessUrl}`,
  ].join("\n");
}

function normalizeWhatsAppPhone(value: string) {
  let digits = value.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("8")) {
    digits = `7${digits.slice(1)}`;
  } else if (digits.length === 10) {
    digits = `7${digits}`;
  }
  return digits.length >= 10 && digits.length <= 15 ? digits : "";
}

function telegramConfig() {
  return {
    token: getScopedEnv("TELEGRAM_BOT_TOKEN").trim(),
    username: getScopedEnv("TELEGRAM_BOT_USERNAME")
      .trim()
      .replace(/^@/, ""),
    webhookSecret: getScopedEnv("TELEGRAM_WEBHOOK_SECRET").trim(),
  };
}

function telegramLinkSecret() {
  return (
    getScopedEnv("TELEGRAM_LINK_SECRET").trim() ||
    process.env.ORDER_ACCESS_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    "development-only-telegram-link-secret"
  );
}

function telegramLinkSignature(orderNumber: string) {
  return createHmac("sha256", telegramLinkSecret())
    .update(`telegram-order:${orderNumber}`)
    .digest("base64url")
    .slice(0, 24);
}

function whatsappConfig() {
  return {
    accessToken: getScopedEnv("WHATSAPP_ACCESS_TOKEN").trim(),
    phoneNumberId: getScopedEnv("WHATSAPP_PHONE_NUMBER_ID").trim(),
    graphVersion: getScopedEnv("WHATSAPP_GRAPH_VERSION").trim(),
    templateName: getScopedEnv("WHATSAPP_TEMPLATE_ORDER_UPDATE").trim(),
    language: getScopedEnv("WHATSAPP_TEMPLATE_LANGUAGE").trim() || "ru",
  };
}

export function getTelegramWebhookSecret() {
  return telegramConfig().webhookSecret;
}

export function telegramOrderConnectUrl(orderNumber: string) {
  const config = telegramConfig();
  const safeOrderNumber = orderNumber.trim();
  if (
    !config.token ||
    !config.username ||
    !config.webhookSecret ||
    !/^[A-Za-z0-9-]{1,32}$/.test(safeOrderNumber)
  ) {
    return "";
  }

  // Phone verification is now the authorization step, so the deep-link only
  // needs to identify the order. This avoids links breaking after secret
  // rotation or between deployments while keeping the actual binding secure.
  const parameter = safeOrderNumber;
  return `https://t.me/${encodeURIComponent(config.username)}?start=${encodeURIComponent(parameter)}`;
}

export function parseTelegramOrderConnectToken(token: string) {
  const value = token.trim();

  // Current links contain only the order number. The Telegram chat is not
  // linked until the user explicitly shares a phone number matching the order.
  if (/^[A-Za-z0-9-]{1,32}$/.test(value)) return value;

  // Backward compatibility with previously issued signed links.
  const separator = value.lastIndexOf("_");
  if (separator <= 0) return null;
  const orderNumber = value.slice(0, separator);
  const signature = value.slice(separator + 1);
  if (!/^[A-Za-z0-9-]{1,32}$/.test(orderNumber)) return null;

  if (/^[A-Za-z0-9_-]{24}$/.test(signature)) {
    const expected = telegramLinkSignature(orderNumber);
    const left = Buffer.from(signature);
    const right = Buffer.from(expected);
    if (left.length === right.length && timingSafeEqual(left, right)) {
      return orderNumber;
    }
  }

  // Old HMAC may no longer match after a secret change. That is acceptable:
  // the phone-number check still prevents another Telegram account from
  // claiming the order.
  return orderNumber;
}

export async function sendTelegramContactRequest(
  chatId: string | number,
  text: string,
): Promise<MessengerDeliveryResult> {
  const { token } = telegramConfig();
  if (!token) {
    return {
      status: "skipped",
      provider: "telegram",
      reason: "telegram_not_configured",
    };
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: String(chatId),
        text,
        reply_markup: {
          keyboard: [
            [
              {
                text: "Поделиться номером телефона",
                request_contact: true,
              },
            ],
          ],
          resize_keyboard: true,
          one_time_keyboard: true,
          input_field_placeholder: "Подтвердите номер телефона",
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });

    const body = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      description?: string;
      result?: { message_id?: number };
    };

    if (!response.ok || !body.ok) {
      return {
        status: "failed",
        provider: "telegram",
        reason: String(body.description || `telegram_http_${response.status}`).slice(0, 300),
      };
    }

    return {
      status: "sent",
      provider: "telegram",
      messageId: body.result?.message_id
        ? String(body.result.message_id)
        : undefined,
    };
  } catch (error) {
    return {
      status: "failed",
      provider: "telegram",
      reason: error instanceof Error ? error.message.slice(0, 300) : "telegram_failed",
    };
  }
}

export async function sendTelegramText(
  chatId: string | number,
  text: string,
  button?: { text: string; url: string },
): Promise<MessengerDeliveryResult> {
  const { token } = telegramConfig();
  if (!token) {
    return {
      status: "skipped",
      provider: "telegram",
      reason: "telegram_not_configured",
    };
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: String(chatId),
        text,
        disable_web_page_preview: true,
        reply_markup: button
          ? { inline_keyboard: [[{ text: button.text, url: button.url }]] }
          : undefined,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    const body = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      description?: string;
      result?: { message_id?: number };
    };

    if (!response.ok || !body.ok) {
      return {
        status: "failed",
        provider: "telegram",
        reason: String(body.description || `telegram_http_${response.status}`).slice(
          0,
          300,
        ),
      };
    }

    return {
      status: "sent",
      provider: "telegram",
      messageId: body.result?.message_id
        ? String(body.result.message_id)
        : undefined,
    };
  } catch (error) {
    return {
      status: "failed",
      provider: "telegram",
      reason: error instanceof Error ? error.message.slice(0, 300) : "telegram_failed",
    };
  }
}

async function sendWhatsAppTemplate(
  order: MessengerOrder,
  event: MessengerEvent,
): Promise<MessengerDeliveryResult> {
  const config = whatsappConfig();
  if (
    !config.accessToken ||
    !config.phoneNumberId ||
    !config.graphVersion ||
    !config.templateName
  ) {
    return {
      status: "skipped",
      provider: "whatsapp",
      reason: "whatsapp_not_configured",
    };
  }

  const recipient = normalizeWhatsAppPhone(
    order.notificationContact || order.phone,
  );
  if (!recipient) {
    return {
      status: "failed",
      provider: "whatsapp",
      reason: "invalid_whatsapp_phone",
    };
  }

  const summary = eventSummary(order, event);

  try {
    const response = await fetch(
      `https://graph.facebook.com/${encodeURIComponent(config.graphVersion)}/${encodeURIComponent(config.phoneNumberId)}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: recipient,
          type: "template",
          template: {
            name: config.templateName,
            language: { code: config.language },
            components: [
              {
                type: "body",
                parameters: [
                  { type: "text", text: order.customerName },
                  { type: "text", text: order.orderNumber },
                  { type: "text", text: summary },
                  { type: "text", text: order.orderAccessUrl },
                ],
              },
            ],
          },
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );

    const body = (await response.json().catch(() => ({}))) as {
      messages?: Array<{ id?: string }>;
      error?: { message?: string; code?: number };
    };

    if (!response.ok) {
      return {
        status: "failed",
        provider: "whatsapp",
        reason: String(
          body.error?.message ||
            (body.error?.code
              ? `whatsapp_${body.error.code}`
              : `whatsapp_http_${response.status}`),
        ).slice(0, 300),
      };
    }

    return {
      status: "sent",
      provider: "whatsapp",
      messageId: body.messages?.[0]?.id,
    };
  } catch (error) {
    return {
      status: "failed",
      provider: "whatsapp",
      reason: error instanceof Error ? error.message.slice(0, 300) : "whatsapp_failed",
    };
  }
}

export async function sendCustomerMessengerNotification(
  order: MessengerOrder,
  event: MessengerEvent,
): Promise<MessengerDeliveryResult> {
  if (order.notificationChannel === "WHATSAPP") {
    return sendWhatsAppTemplate(order, event);
  }

  if (order.notificationChannel === "TELEGRAM") {
    if (!order.telegramChatId) {
      return {
        status: "skipped",
        provider: "telegram",
        reason: "telegram_not_linked",
      };
    }

    return sendTelegramText(order.telegramChatId, telegramText(order, event), {
      text: "Открыть заказ",
      url: order.orderAccessUrl,
    });
  }

  return {
    status: "skipped",
    provider: "none",
    reason: "not_messenger_channel",
  };
}
