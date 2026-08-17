import type { OrderStatus } from "@prisma/client";
import { sendSiteMail } from "@/lib/mailer";
import { prisma } from "@/lib/prisma";
import {
  checkPublicSite,
  formatSiteChecks,
  recordSiteCheck,
} from "@/lib/siteMonitor";
import { SITE_BRAND, SITE_KEY, getPublicBaseUrl } from "@/lib/siteConfig";

const STATUS_LABELS: Record<OrderStatus, string> = {
  NEW: "Новые",
  CONFIRMED: "Подтверждённые",
  PACKING: "На сборке",
  SHIPPED: "Отправленные",
  DONE: "Выполненные",
  CANCELED: "Отменённые",
};

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Asia/Almaty",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(value);
}

export async function sendWeeklySiteReport() {
  const now = new Date();
  const periodStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const currentCheck = await checkPublicSite();
  await recordSiteCheck(currentCheck);

  const [healthChecks, orderGroups, pendingNotifications] = await Promise.all([
    prisma.siteHealthCheck.findMany({
      where: { siteKey: SITE_KEY, createdAt: { gte: periodStart } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.order.groupBy({
      by: ["status"],
      where: { createdAt: { gte: periodStart } },
      _count: { _all: true },
      _sum: { totalAmount: true },
      orderBy: { status: "asc" },
    }),
    prisma.order.count({
      where: {
        notificationStatus: { in: ["PENDING", "FAILED"] },
        createdAt: { gte: periodStart },
      },
    }),
  ]);

  const healthyChecks = healthChecks.filter((check) => check.isHealthy).length;
  const uptimePercent = healthChecks.length
    ? Math.round((healthyChecks / healthChecks.length) * 1000) / 10
    : 0;
  const totalOrders = orderGroups.reduce(
    (sum, group) => sum + group._count._all,
    0,
  );
  const totalAmount = orderGroups.reduce(
    (sum, group) => sum + (group._sum.totalAmount || 0),
    0,
  );
  const periodLabel = `${formatDate(periodStart)} — ${formatDate(now)}`;
  const orderLines = orderGroups.length
    ? orderGroups.map(
        (group) =>
          `${STATUS_LABELS[group.status]}: ${group._count._all} • ${(group._sum.totalAmount || 0).toLocaleString("ru-RU")} ₸`,
      )
    : ["Заказов за период не было."];
  const text = [
    `Еженедельный отчёт ${SITE_BRAND}`,
    `Период: ${periodLabel}`,
    "",
    "Сайт",
    `Текущее состояние: ${currentCheck.isHealthy ? "работает нормально" : "обнаружена проблема"}`,
    `Успешных контрольных проверок: ${healthyChecks} из ${healthChecks.length} (${uptimePercent} %)`,
    `Максимальное время текущей проверки: ${currentCheck.responseTimeMs} мс`,
    formatSiteChecks(currentCheck.checks),
    "",
    "Заказы",
    `Всего: ${totalOrders}`,
    `Сумма созданных заказов: ${totalAmount.toLocaleString("ru-RU")} ₸`,
    `Ожидают почтового уведомления: ${pendingNotifications}`,
    ...orderLines,
    "",
    `Админка: ${getPublicBaseUrl()}/admin/orders`,
  ].join("\n");
  const delivery = await sendSiteMail({
    subject: `Еженедельный отчёт ${SITE_BRAND} • ${periodLabel}`,
    text,
  });

  return {
    delivery,
    periodStart,
    periodEnd: now,
    healthChecks: healthChecks.length,
    healthyChecks,
    uptimePercent,
    totalOrders,
    totalAmount,
    pendingNotifications,
    currentHealthy: currentCheck.isHealthy,
  };
}
