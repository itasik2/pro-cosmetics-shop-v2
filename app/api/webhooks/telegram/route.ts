export const runtime = "nodejs";
export const revalidate = 0;

import { NextResponse } from "next/server";
import {
  getTelegramWebhookSecret,
  parseTelegramOrderConnectToken,
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
    chat?: { id?: number | string; type?: string };
    from?: { username?: string };
  };
};

const TELEGRAM_FALLBACK_WINDOW_MS = 6 * 60 * 60 * 1000;

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
  const chatId = message?.chat?.id;
  const text = String(message?.text || "").trim();

  if (!chatId || message?.chat?.type !== "private" || !text.startsWith("/start")) {
    return NextResponse.json({ ok: true });
  }

  const match = text.match(/^\/start(?:@\w+)?(?:\s+([A-Za-z0-9_-]{1,64}))?/);
  const connectToken = String(match?.[1] || "").trim();
  const username = String(message?.from?.username || "").trim();

  if (connectToken.startsWith("stock_")) {
    const alertId = parseStockAlertTelegramToken(connectToken);
    if (!alertId) {
      await sendTelegramText(chatId, "Ссылка уведомления о поступлении недействительна. Вернитесь на страницу товара и создайте заявку заново.");
      return NextResponse.json({ ok: true });
    }

    const alert = await prisma.stockAlert.findUnique({
      where: { id: alertId },
      select: { id: true, status: true, telegramChatId: true },
    });
    if (!alert || alert.status !== "PENDING") {
      await sendTelegramText(chatId, "Эта заявка уже закрыта или не найдена.");
      return NextResponse.json({ ok: true });
    }
    if (alert.telegramChatId && alert.telegramChatId !== String(chatId)) {
      await sendTelegramText(chatId, "Эта заявка уже подключена к другому Telegram-чату.");
      return NextResponse.json({ ok: true });
    }

    await prisma.stockAlert.update({
      where: { id: alert.id },
      data: {
        telegramChatId: String(chatId),
        notificationContact: username ? `@${username}` : String(chatId),
        lastError: null,
      },
    });

    await sendTelegramText(chatId, "Уведомление подключено. Мы напишем сюда, когда товар появится в наличии.");
    await processStockAlertById(alert.id);
    return NextResponse.json({ ok: true, stockAlert: alert.id });
  }

  let order: {
    id: string;
    orderNumber: string;
    telegramChatId: string | null;
  } | null = null;

  if (connectToken) {
    const orderNumber = parseTelegramOrderConnectToken(connectToken);
    if (!orderNumber) {
      await sendTelegramText(chatId, "Ссылка подключения Telegram недействительна. Вернитесь на страницу заказа и откройте её заново.");
      return NextResponse.json({ ok: true });
    }

    order = await prisma.order.findFirst({
      where: { orderNumber, notificationChannel: "TELEGRAM" },
      select: { id: true, orderNumber: true, telegramChatId: true },
    });
  } else if (username) {
    order = await findRecentOrderByTelegramUsername(username);
  }

  if (!order) {
    await sendTelegramText(
      chatId,
      username
        ? "Не удалось однозначно найти свежий заказ для вашего Telegram. Вернитесь на страницу заказа и нажмите «Подключить Telegram» ещё раз."
        : "В Telegram не задан @username. Вернитесь на страницу заказа и нажмите «Подключить Telegram» ещё раз.",
    );
    return NextResponse.json({ ok: true });
  }

  if (order.telegramChatId && order.telegramChatId !== String(chatId)) {
    await sendTelegramText(chatId, "Этот заказ уже подключён к другому Telegram-чату.");
    return NextResponse.json({ ok: true });
  }

  await prisma.order.update({
    where: { id: order.id },
    data: {
      telegramChatId: String(chatId),
      notificationContact: username ? `@${username}` : String(chatId),
      messengerNotificationStatus: "PENDING",
      messengerNotificationLastError: null,
    },
  });

  await sendOrderMessengerNotification(order.id, "ORDER_CREATED");
  return NextResponse.json({ ok: true, order: order.orderNumber });
}
