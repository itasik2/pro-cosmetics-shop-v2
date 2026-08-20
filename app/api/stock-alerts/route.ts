export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";
import { stockAlertTelegramConnectUrl } from "@/lib/stockAlerts";

const Schema = z.object({
  productId: z.string().min(1).max(80),
  variantId: z.string().max(120).optional().nullable(),
  customerName: z.string().trim().max(80).optional().or(z.literal("")),
  channel: z.enum(["EMAIL", "TELEGRAM", "WHATSAPP"]),
  contact: z.string().trim().min(2).max(160),
});

function normalizePhone(value: string) {
  let digits = value.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("8")) digits = `7${digits.slice(1)}`;
  else if (digits.length === 10) digits = `7${digits}`;
  return digits;
}

function normalizeContact(channel: string, value: string) {
  const contact = value.trim();
  if (channel === "EMAIL") return contact.toLowerCase();
  if (channel === "TELEGRAM" || channel === "WHATSAPP") {
    return normalizePhone(contact);
  }
  return contact;
}

function normalizeVariants(value: unknown) {
  return Array.isArray(value)
    ? value.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object")
    : [];
}

export async function POST(req: Request) {
  const ip = getClientIp(req);
  if (ip) {
    const limit = checkRateLimit(`stock-alert:${ip}`, 10, 60_000);
    if (!limit.ok) {
      return NextResponse.json(
        { error: "too_many_requests", message: "Слишком много заявок. Попробуйте позже." },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } },
      );
    }
  }

  const parsed = Schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_error", message: "Проверьте контактные данные." },
      { status: 400 },
    );
  }

  const { productId, channel } = parsed.data;
  const variantId = String(parsed.data.variantId || "").trim() || null;
  const contact = normalizeContact(channel, parsed.data.contact);

  if (channel === "EMAIL" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) {
    return NextResponse.json(
      { error: "invalid_email", message: "Проверьте правильность email." },
      { status: 400 },
    );
  }
  if (
    (channel === "TELEGRAM" || channel === "WHATSAPP") &&
    (contact.length < 10 || contact.length > 15)
  ) {
    return NextResponse.json(
      {
        error: channel === "TELEGRAM" ? "invalid_telegram_phone" : "invalid_whatsapp",
        message:
          channel === "TELEGRAM"
            ? "Проверьте номер телефона, привязанный к Telegram."
            : "Проверьте номер WhatsApp.",
      },
      { status: 400 },
    );
  }

  const product = await prisma.product.findFirst({
    where: { id: productId, isPublished: true, enrichmentStatus: { not: "MERGED" } },
    select: { id: true, name: true, stock: true, variants: true },
  });
  if (!product) {
    return NextResponse.json({ error: "product_not_found" }, { status: 404 });
  }

  let variantLabel: string | null = null;
  if (variantId) {
    const variant = normalizeVariants(product.variants).find(
      (row) => String(row.id || "") === variantId,
    );
    if (!variant) {
      return NextResponse.json(
        { error: "variant_not_found", message: "Этот вариант товара не найден." },
        { status: 404 },
      );
    }
    if (Math.trunc(Number(variant.stock) || 0) > 0) {
      return NextResponse.json(
        { error: "already_in_stock", message: "Этот вариант уже есть в наличии." },
        { status: 409 },
      );
    }
    variantLabel = String(variant.label || "").trim() || null;
  } else if (product.stock > 0) {
    return NextResponse.json(
      { error: "already_in_stock", message: "Товар уже есть в наличии." },
      { status: 409 },
    );
  }

  const existing = await prisma.stockAlert.findFirst({
    where: {
      productId,
      variantId,
      notificationChannel: channel,
      notificationContact: contact,
      status: "PENDING",
    },
    orderBy: { createdAt: "desc" },
  });

  const alert =
    existing ||
    (await prisma.stockAlert.create({
      data: {
        productId,
        variantId,
        variantLabel,
        customerName: parsed.data.customerName?.trim() || null,
        notificationChannel: channel,
        notificationContact: contact,
      },
    }));

  return NextResponse.json({
    ok: true,
    alertId: alert.id,
    existing: Boolean(existing),
    telegramConnectUrl:
      channel === "TELEGRAM" ? stockAlertTelegramConnectUrl(alert.id) : "",
    message:
      channel === "TELEGRAM"
        ? "Заявка сохранена. Откройте Telegram-бота и подтвердите номер телефона."
        : "Заявка сохранена. Мы сообщим, когда товар появится в наличии.",
  });
}