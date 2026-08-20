export const runtime = "nodejs";
export const revalidate = 0;

import { NextResponse } from "next/server";
import {
  getTelegramWebhookSecret,
  parseTelegramOrderConnectToken,
  sendTelegramContactRequest,
  sendTelegramText,
} from "@/lib/messenger";
import { sendOrderMessengerNotification } from "@/lib/orderMessengerNotifications";
import { prisma } from "@/lib/prisma";
import {
  parseStockAlertTelegramToken,
  processStockAlertById,
} from "@/lib/stockAlerts";

type TelegramUpdate = {
  message?: {
    text?: string;
    contact?: {
      phone_number?: string;
      user_id?: number | string;
    };
    chat?: { id?: number | string; type?: string };
    from?: { id?: number | string; username?: string };
  };
};

const TELEGRAM_FALLBACK_WINDOW_MS = 6 * 60 * 60 * 1000;
const TELEGRAM_PHONE_LINK_WINDOW_MS = 15 * 60 * 1000;

function normalizePhone(value: string) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("8")) {
    digits = `7${digits.slice(1)}`;
  } else if (digits.length === 10) {
    digits = `7${digits}`;
  }
  return digits.length >= 10 && digits.length <= 15 ? digits : "";
}

async function clearPendingForChat(chatId: string) {
  await prisma.$transaction([
    prisma.order.updateMany({
      where: { telegramPendingChatId: chatId },
      data: { telegramPendingChatId: null, telegramPendingAt: null },
    }),
    prisma.stockAlert.updateMany({
      where: { telegramPendingChatId: chatId },
      data: { telegramPendingChatId: null, telegramPendingAt: null },
    }),
  ]);
}

async function requestPhoneForOrder(
  order: { id: string; orderNumber: string; phone: string; telegramChatId: string | null },
  chatId: string,
) {
  if (order.telegramChatId && order.telegramChatId !== chatId) {
    await sendTelegramText(chatId, "Этот заказ уже подключён к другому Telegram-чату.");
    return;
  }
  if (order.telegramChatId === chatId) {
    await sendTelegramText(chatId, `Telegram уже подключён к заказу ${order.orderNumber}.`);
    return;
  }

  const expectedPhone = normalizePhone(order.phone);
  if (!expectedPhone) {
    await sendTelegramText(
      chatId,
      "В заказе указан некорректный номер телефона. Обратитесь в магазин, чтобы исправить контакт.",
    );
    return;
  }

  await clearPendingForChat(chatId);
  await prisma.order.update({
    where: { id: order.id },
    data: {
      telegramPendingChatId: chatId,
      telegramPendingAt: new Date(),
    },
  });

  await sendTelegramContactRequest(
    chatId,
    `Для подключения заказа ${order.orderNumber} подтвердите номер телефона. Нажмите кнопку «Поделиться номером телефона» ниже. Бот получит номер только после вашего нажатия.`,
  );
}

async function requestPhoneForStockAlert(
  alert: {
    id: string;
    notificationContact: string;
    telegramChatId: string | null;
  },
  chatId: string,
  username: string,
) {
  if (alert.telegramChatId && alert.telegramChatId !== chatId) {
    await sendTelegramText(chatId, "Эта заявка уже подключена к другому Telegram-чату.");
    return;
  }
  if (alert.telegramChatId === chatId) {
    await sendTelegramText(chatId, "Уведомление о поступлении уже подключено к этому Telegram-чату.");
    return;
  }

  const expectedPhone = normalizePhone(alert.notificationContact);
  if (!expectedPhone) {
    // Backward compatibility for alerts created before phone-based Telegram linking.
    await prisma.stockAlert.update({
      where: { id: alert.id },
      data: {
        telegramChatId: chatId,
        notificationContact: username ? `@${username}` : chatId,
        telegramPendingChatId: null,
        telegramPendingAt: null,
        lastError: null,
      },
    });
    await sendTelegramText(
      chatId,
      "Уведомление подключено. Мы напишем сюда, когда товар появится в наличии.",
    );
    await processStockAlertById(alert.id);
    return;
  }

  await clearPendingForChat(chatId);
  await prisma.stockAlert.update({
    where: { id: alert.id },
    data: {
      telegramPendingChatId: chatId,
      telegramPendingAt: new Date(),
    },
  });

  await sendTelegramContactRequest(
    chatId,
    "Подтвердите номер телефона для уведомления о поступлении. Нажмите кнопку «Поделиться номером телефона» ниже.",
  );
}

async function handleSharedContact(args: {
  chatId: string;
  fromId: string;
  contactPhone: string;
  contactUserId: string;
}) {
  if (
    args.contactUserId &&
    args.fromId &&
    args.contactUserId !== args.fromId
  ) {
    await sendTelegramText(
      args.chatId,
      "Нужно поделиться именно своим номером через кнопку бота, а не отправлять чужой контакт.",
    );
    return;
  }

  const sharedPhone = normalizePhone(args.contactPhone);
  if (!sharedPhone) {
    await sendTelegramText(args.chatId, "Telegram передал некорректный номер телефона. Попробуйте подключение ещё раз.");
    return;
  }

  const cutoff = new Date(Date.now() - TELEGRAM_PHONE_LINK_WINDOW_MS);
  const [order, alert] = await Promise.all([
    prisma.order.findFirst({
      where: {
        telegramPendingChatId: args.chatId,
        telegramPendingAt: { gte: cutoff },
        notificationChannel: "TELEGRAM",
      },
      select: {
        id: true,
        orderNumber: true,
        phone: true,
        telegramChatId: true,
        telegramPendingAt: true,
      },
      orderBy: { telegramPendingAt: "desc" },
    }),
    prisma.stockAlert.findFirst({
      where: {
        telegramPendingChatId: args.chatId,
        telegramPendingAt: { gte: cutoff },
        notificationChannel: "TELEGRAM",
        status: "PENDING",
      },
      select: {
        id: true,
        notificationContact: true,
        telegramChatId: true,
        telegramPendingAt: true,
      },
      orderBy: { telegramPendingAt: "desc" },
    }),
  ]);

  const candidates = [
    order
      ? {
          type: "ORDER" as const,
          at: order.telegramPendingAt?.getTime() || 0,
          expectedPhone: normalizePhone(order.phone),
          value: order,
        }
      : null,
    alert
      ? {
          type: "STOCK_ALERT" as const,
          at: alert.telegramPendingAt?.getTime() || 0,
          expectedPhone: normalizePhone(alert.notificationContact),
          value: alert,
        }
      : null,
  ]
    .filter(Boolean)
    .sort((a, b) => (b?.at || 0) - (a?.at || 0));

  const pending = candidates[0];
  if (!pending) {
    await sendTelegramText(
      args.chatId,
      "Нет активной заявки на подключение. Вернитесь на страницу заказа или товара и нажмите «Подключить Telegram» ещё раз.",
    );
    return;
  }

  if (!pending.expectedPhone || pending.expectedPhone !== sharedPhone) {
    await sendTelegramText(
      args.chatId,
      "Номер Telegram не совпадает с номером, указанным на сайте. Проверьте номер в заказе или заявке и запустите подключение заново.",
    );
    return;
  }

  if (pending.type === "ORDER") {
    const linkedOrder = pending.value as typeof order;
    if (!linkedOrder) return;
    if (linkedOrder.telegramChatId && linkedOrder.telegramChatId !== args.chatId) {
      await sendTelegramText(args.chatId, "Этот заказ уже подключён к другому Telegram-чату.");
      return;
    }

    await prisma.order.update({
      where: { id: linkedOrder.id },
      data: {
        telegramChatId: args.chatId,
        notificationContact: sharedPhone,
        telegramPendingChatId: null,
        telegramPendingAt: null,
        messengerNotificationStatus: "PENDING",
        messengerNotificationLastError: null,
      },
    });

    await sendTelegramText(
      args.chatId,
      `Telegram подключён к заказу ${linkedOrder.orderNumber}. Уведомления по заказу будут приходить сюда.`,
    );
    await sendOrderMessengerNotification(linkedOrder.id, "ORDER_CREATED");
    return;
  }

  const linkedAlert = pending.value as typeof alert;
  if (!linkedAlert) return;
  if (linkedAlert.telegramChatId && linkedAlert.telegramChatId !== args.chatId) {
    await sendTelegramText(args.chatId, "Эта заявка уже подключена к другому Telegram-чату.");
    return;
  }

  await prisma.stockAlert.update({
    where: { id: linkedAlert.id },
    data: {
      telegramChatId: args.chatId,
      notificationContact: sharedPhone,
      telegramPendingChatId: null,
      telegramPendingAt: null,
      lastError: null,
    },
  });

  await sendTelegramText(
    args.chatId,
    "Уведомление подключено. Мы напишем сюда, когда товар появится в наличии.",
  );
  await processStockAlertById(linkedAlert.id);
}

async function findRecentOrderByTelegramUsername(username: string) {
  const normalized = username.trim().replace(/^@/, "");
  if (!normalized) return null;

  const candidates = await prisma.order.findMany({
    where: {
      notificationChannel: "TELEGRAM",
      notificationContact: {
        equals: `@${normalized}`,
        mode: "insensitive",
      },
      telegramChatId: null,
      archivedAt: null,
      createdAt: { gte: new Date(Date.now() - TELEGRAM_FALLBACK_WINDOW_MS) },
    },
    select: { id: true, orderNumber: true, telegramChatId: true },
    orderBy: { createdAt: "desc" },
    take: 2,
  });

  return candidates.length === 1 ? candidates[0] : null;
}

export async function POST(req: Request) {
  const expectedSecret = getTelegramWebhookSecret();
  if (!expectedSecret) {
    return NextResponse.json({ error: "telegram_webhook_not_configured" }, { status: 503 });
  }

  const actualSecret = req.headers.get("x-telegram-bot-api-secret-token") || "";
  if (actualSecret !== expectedSecret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const update = (await req.json().catch(() => ({}))) as TelegramUpdate;
  const message = update.message;
  const chatIdValue = message?.chat?.id;

  if (!chatIdValue || message?.chat?.type !== "private") {
    return NextResponse.json({ ok: true });
  }

  const chatId = String(chatIdValue);
  const fromId = String(message?.from?.id || "");
  const username = String(message?.from?.username || "").trim();
  const contactPhone = String(message?.contact?.phone_number || "").trim();

  if (contactPhone) {
    await handleSharedContact({
      chatId,
      fromId,
      contactPhone,
      contactUserId: String(message?.contact?.user_id || ""),
    });
    return NextResponse.json({ ok: true });
  }

  const text = String(message?.text || "").trim();
  if (!text.startsWith("/start")) {
    return NextResponse.json({ ok: true });
  }

  const match = text.match(/^\/start(?:@\w+)?(?:\s+([A-Za-z0-9_-]{1,64}))?/);
  const connectToken = String(match?.[1] || "").trim();

  if (connectToken.startsWith("stock_")) {
    const alertId = parseStockAlertTelegramToken(connectToken);
    if (!alertId) {
      await sendTelegramText(chatId, "Ссылка уведомления о поступлении недействительна. Вернитесь на страницу товара и создайте заявку заново.");
      return NextResponse.json({ ok: true });
    }

    const alert = await prisma.stockAlert.findUnique({
      where: { id: alertId },
      select: {
        id: true,
        status: true,
        notificationContact: true,
        telegramChatId: true,
      },
    });
    if (!alert || alert.status !== "PENDING") {
      await sendTelegramText(chatId, "Эта заявка уже закрыта или не найдена.");
      return NextResponse.json({ ok: true });
    }

    await requestPhoneForStockAlert(alert, chatId, username);
    return NextResponse.json({ ok: true, stockAlert: alert.id });
  }

  if (connectToken) {
    const orderNumber = parseTelegramOrderConnectToken(connectToken);
    if (!orderNumber) {
      await sendTelegramText(chatId, "Ссылка подключения Telegram недействительна. Вернитесь на страницу заказа и откройте её заново.");
      return NextResponse.json({ ok: true });
    }

    const order = await prisma.order.findFirst({
      where: { orderNumber, notificationChannel: "TELEGRAM" },
      select: {
        id: true,
        orderNumber: true,
        phone: true,
        telegramChatId: true,
      },
    });
    if (!order) {
      await sendTelegramText(chatId, "Заказ для подключения Telegram не найден.");
      return NextResponse.json({ ok: true });
    }

    await requestPhoneForOrder(order, chatId);
    return NextResponse.json({ ok: true, order: order.orderNumber });
  }

  // Backward compatibility for orders created when Telegram @username was required.
  const legacyOrder = username
    ? await findRecentOrderByTelegramUsername(username)
    : null;
  if (legacyOrder) {
    await prisma.order.update({
      where: { id: legacyOrder.id },
      data: {
        telegramChatId: chatId,
        notificationContact: `@${username}`,
        messengerNotificationStatus: "PENDING",
        messengerNotificationLastError: null,
      },
    });
    await sendOrderMessengerNotification(legacyOrder.id, "ORDER_CREATED");
    return NextResponse.json({ ok: true, order: legacyOrder.orderNumber });
  }

  await sendTelegramText(
    chatId,
    "Откройте персональную страницу заказа или товара и нажмите «Подключить Telegram». Бот попросит подтвердить номер телефона.",
  );
  return NextResponse.json({ ok: true });
}