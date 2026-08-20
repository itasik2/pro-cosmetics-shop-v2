import { createHmac, timingSafeEqual } from "node:crypto";
import { sendSiteMail } from "@/lib/mailer";
import { sendTelegramText } from "@/lib/messenger";
import { prisma } from "@/lib/prisma";
import { getPublicBaseUrl, getScopedEnv } from "@/lib/siteConfig";

function linkSecret() {
  return (
    getScopedEnv("TELEGRAM_LINK_SECRET").trim() ||
    process.env.ORDER_ACCESS_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    "development-only-stock-alert-secret"
  );
}

function alertSignature(id: string) {
  return createHmac("sha256", linkSecret())
    .update(`stock-alert:${id}`)
    .digest("base64url")
    .slice(0, 20);
}

export function stockAlertTelegramConnectUrl(id: string) {
  const username = getScopedEnv("TELEGRAM_BOT_USERNAME").trim().replace(/^@/, "");
  if (!username || !/^[A-Za-z0-9_-]{10,40}$/.test(id)) return "";
  const token = `stock_${id}_${alertSignature(id)}`;
  if (token.length > 64) return "";
  return `https://t.me/${encodeURIComponent(username)}?start=${encodeURIComponent(token)}`;
}

export function parseStockAlertTelegramToken(token: string) {
  const match = token.match(/^stock_([A-Za-z0-9_-]{10,40})_([A-Za-z0-9_-]{20})$/);
  if (!match) return null;
  const id = match[1];
  const signature = match[2];
  const expected = alertSignature(id);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  return id;
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

function variants(value: unknown) {
  return Array.isArray(value)
    ? value.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object")
    : [];
}

function alertIsAvailable(alert: {
  variantId: string | null;
  product: { stock: number; variants: unknown };
}) {
  if (!alert.variantId) return alert.product.stock > 0;
  const variant = variants(alert.product.variants).find(
    (row) => String(row.id || "") === alert.variantId,
  );
  return Math.trunc(Number(variant?.stock) || 0) > 0;
}

async function sendWhatsAppRestock(args: {
  phone: string;
  customerName?: string | null;
  productName: string;
  variantLabel?: string | null;
  productUrl: string;
}) {
  const accessToken = getScopedEnv("WHATSAPP_ACCESS_TOKEN").trim();
  const phoneNumberId = getScopedEnv("WHATSAPP_PHONE_NUMBER_ID").trim();
  const graphVersion = getScopedEnv("WHATSAPP_GRAPH_VERSION").trim();
  const templateName = getScopedEnv("WHATSAPP_TEMPLATE_RESTOCK").trim();
  const language = getScopedEnv("WHATSAPP_TEMPLATE_LANGUAGE").trim() || "ru";
  const recipient = normalizeWhatsAppPhone(args.phone);

  if (!accessToken || !phoneNumberId || !graphVersion || !templateName) {
    return { status: "skipped" as const, reason: "whatsapp_restock_not_configured" };
  }
  if (!recipient) {
    return { status: "failed" as const, reason: "invalid_whatsapp_phone" };
  }

  const productLabel = args.variantLabel
    ? `${args.productName} (${args.variantLabel})`
    : args.productName;

  try {
    const response = await fetch(
      `https://graph.facebook.com/${encodeURIComponent(graphVersion)}/${encodeURIComponent(phoneNumberId)}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: recipient,
          type: "template",
          template: {
            name: templateName,
            language: { code: language },
            components: [
              {
                type: "body",
                parameters: [
                  { type: "text", text: args.customerName || "клиент" },
                  { type: "text", text: productLabel },
                  { type: "text", text: args.productUrl },
                ],
              },
            ],
          },
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );

    const body = (await response.json().catch(() => ({}))) as {
      error?: { message?: string };
    };
    if (!response.ok) {
      return {
        status: "failed" as const,
        reason: String(body.error?.message || `whatsapp_http_${response.status}`).slice(0, 300),
      };
    }
    return { status: "sent" as const };
  } catch (error) {
    return {
      status: "failed" as const,
      reason: error instanceof Error ? error.message.slice(0, 300) : "whatsapp_failed",
    };
  }
}

async function deliverAlert(alert: {
  id: string;
  customerName: string | null;
  notificationChannel: string;
  notificationContact: string;
  telegramChatId: string | null;
  variantLabel: string | null;
  product: { name: string; slug: string };
}) {
  const productUrl = `${getPublicBaseUrl()}/shop/${encodeURIComponent(alert.product.slug)}`;
  const productLabel = alert.variantLabel
    ? `${alert.product.name} (${alert.variantLabel})`
    : alert.product.name;

  if (alert.notificationChannel === "EMAIL") {
    const result = await sendSiteMail({
      to: alert.notificationContact,
      subject: `${productLabel} снова в наличии`,
      text: [
        alert.customerName ? `Здравствуйте, ${alert.customerName}!` : "Здравствуйте!",
        "",
        `Товар «${productLabel}» снова появился в наличии.`,
        `Открыть товар: ${productUrl}`,
        "",
        "Количество ограничено, наличие может измениться.",
      ].join("\n"),
    });
    if (result.status === "sent") return { status: "sent" as const };
    return { status: result.status, reason: result.reason } as const;
  }

  if (alert.notificationChannel === "TELEGRAM") {
    if (!alert.telegramChatId) {
      return { status: "skipped" as const, reason: "telegram_not_linked" };
    }
    const result = await sendTelegramText(
      alert.telegramChatId,
      [
        alert.customerName ? `Здравствуйте, ${alert.customerName}!` : "Здравствуйте!",
        "",
        `Товар «${productLabel}» снова в наличии.`,
        `Открыть товар: ${productUrl}`,
      ].join("\n"),
      { text: "Открыть товар", url: productUrl },
    );
    if (result.status === "sent") return { status: "sent" as const };
    return { status: result.status, reason: result.reason } as const;
  }

  if (alert.notificationChannel === "WHATSAPP") {
    return sendWhatsAppRestock({
      phone: alert.notificationContact,
      customerName: alert.customerName,
      productName: alert.product.name,
      variantLabel: alert.variantLabel,
      productUrl,
    });
  }

  return { status: "failed" as const, reason: "unsupported_channel" };
}

export async function processStockAlertById(id: string) {
  const alert = await prisma.stockAlert.findUnique({
    where: { id },
    include: { product: { select: { name: true, slug: true, stock: true, variants: true } } },
  });
  if (!alert || alert.status !== "PENDING") return { status: "ignored" as const };
  if (!alertIsAvailable(alert)) return { status: "waiting_stock" as const };

  const delivery = await deliverAlert(alert);
  if (delivery.status === "sent") {
    await prisma.stockAlert.update({
      where: { id: alert.id },
      data: { status: "SENT", notifiedAt: new Date(), lastError: null },
    });
    return { status: "sent" as const };
  }

  if (delivery.status === "skipped") {
    await prisma.stockAlert.update({
      where: { id: alert.id },
      data: { lastError: delivery.reason },
    });
    return { status: "skipped" as const, reason: delivery.reason };
  }

  const attempts = alert.attempts + 1;
  await prisma.stockAlert.update({
    where: { id: alert.id },
    data: {
      attempts,
      status: attempts >= 5 ? "FAILED" : "PENDING",
      lastError: delivery.reason,
    },
  });
  return { status: "failed" as const, reason: delivery.reason };
}

async function processAlertIds(ids: string[]) {
  let sent = 0;
  let waitingStock = 0;
  let skipped = 0;
  let failed = 0;

  for (const id of ids) {
    const result = await processStockAlertById(id);
    if (result.status === "sent") sent += 1;
    else if (result.status === "waiting_stock") waitingStock += 1;
    else if (result.status === "skipped") skipped += 1;
    else if (result.status === "failed") failed += 1;
  }

  return { checked: ids.length, sent, waitingStock, skipped, failed };
}

export async function processPendingStockAlerts(limit = 50) {
  const alerts = await prisma.stockAlert.findMany({
    where: { status: "PENDING", attempts: { lt: 5 } },
    select: { id: true },
    orderBy: { createdAt: "asc" },
    take: Math.max(1, Math.min(limit, 100)),
  });

  return processAlertIds(alerts.map((alert) => alert.id));
}

export async function processStockAlertsForProduct(productId: string, limit = 100) {
  const alerts = await prisma.stockAlert.findMany({
    where: {
      productId,
      status: "PENDING",
      attempts: { lt: 5 },
    },
    select: { id: true },
    orderBy: { createdAt: "asc" },
    take: Math.max(1, Math.min(limit, 100)),
  });

  return processAlertIds(alerts.map((alert) => alert.id));
}
