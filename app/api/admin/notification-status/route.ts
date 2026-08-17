export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuard";
import {
  getMailConfigurationStatus,
  sendSiteMail,
} from "@/lib/mailer";
import { prisma } from "@/lib/prisma";
import { SITE_BRAND, SITE_KEY, getPublicBaseUrl } from "@/lib/siteConfig";

async function readStatus() {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [latest, total, healthy, pendingOrderNotifications] = await Promise.all([
    prisma.siteHealthCheck.findFirst({
      where: { siteKey: SITE_KEY },
      orderBy: { createdAt: "desc" },
    }),
    prisma.siteHealthCheck.count({
      where: { siteKey: SITE_KEY, createdAt: { gte: since } },
    }),
    prisma.siteHealthCheck.count({
      where: {
        siteKey: SITE_KEY,
        isHealthy: true,
        createdAt: { gte: since },
      },
    }),
    prisma.order.count({
      where: { notificationStatus: { in: ["PENDING", "FAILED"] } },
    }),
  ]);

  return {
    mail: getMailConfigurationStatus(),
    pendingOrderNotifications,
    monitor: {
      latest: latest
        ? {
            isHealthy: latest.isHealthy,
            responseTimeMs: latest.responseTimeMs,
            error: latest.error,
            createdAt: latest.createdAt.toISOString(),
          }
        : null,
      checksLast7Days: total,
      uptimePercent: total ? Math.round((healthy / total) * 1000) / 10 : null,
    },
  };
}

export async function GET() {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  return NextResponse.json(await readStatus(), {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST() {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  const delivery = await sendSiteMail({
    subject: `Тест уведомлений ${SITE_BRAND}`,
    text: [
      `Почтовые уведомления сайта ${getPublicBaseUrl()} работают.`,
      "",
      "Новые заказы и еженедельные отчёты будут приходить на этот адрес.",
      `Время теста: ${new Date().toLocaleString("ru-RU", { timeZone: "Asia/Almaty" })}`,
    ].join("\n"),
  });

  return NextResponse.json(
    { ok: delivery.status === "sent", delivery },
    { status: delivery.status === "sent" ? 200 : 503 },
  );
}
