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

type TelegramUpdate = {
  message?: {
    text?: string;
    chat?: { id?: number | string; type?: string };
    from?: { username?: string };
  };
};

export async function POST(req: Request) {
  const expectedSecret = getTelegramWebhookSecret();
  if (!expectedSecret) {
    return NextResponse.json(
      { error: "telegram_webhook_not_configured" },
      { status: 503 },
    );
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
  const orderNumber = connectToken
    ? parseTelegramOrderConnectToken(connectToken)
    : null;

  if (!orderNumber) {
    await sendTelegramText(
      chatId,
      "Откройте ссылку «Подключить Telegram» на странице вашего заказа.",
    );
    return NextResponse.json({ ok: true });
  }

  const order = await prisma.order.findFirst({
    where: {
      orderNumber,
      notificationChannel: "TELEGRAM",
    },
    select: {
      id: true,
      orderNumber: true,
      telegramChatId: true,
    },
  });

  if (!order) {
    await sendTelegramText(
      chatId,
      "Не удалось привязать заказ. Откройте Telegram заново по кнопке на странице заказа.",
    );
    return NextResponse.json({ ok: true });
  }

  if (order.telegramChatId && order.telegramChatId !== String(chatId)) {
    await sendTelegramText(
      chatId,
      "Этот заказ уже подключён к другому Telegram-чату.",
    );
    return NextResponse.json({ ok: true });
  }

  const username = String(message?.from?.username || "").trim();
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
