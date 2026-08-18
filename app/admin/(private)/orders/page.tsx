// app/admin/(private)/orders/page.tsx
import Link from "next/link";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type OrdersView = "active" | "archive" | "all";

function statusLabel(s: string) {
  const map: Record<string, string> = {
    NEW: "Новый",
    CONFIRMED: "Подтверждён",
    PACKING: "Сборка",
    SHIPPED: "Отправлен",
    DONE: "Завершён",
    CANCELED: "Отменён",
  };
  return map[s] || s;
}

function paymentStatusLabel(s: string) {
  const map: Record<string, string> = {
    UNPAID: "Не оплачен",
    DUE_ON_DELIVERY: "Оплата при получении",
    PENDING: "Ожидает проверки",
    PAID: "Оплачен",
    REFUNDED: "Возврат",
  };
  return map[s] || s;
}

function normalizeView(value: string): OrdersView {
  if (value === "archive" || value === "all") return value;
  return "active";
}

function viewClass(active: boolean) {
  return active
    ? "rounded-xl bg-black px-3 py-2 text-sm text-white"
    : "rounded-xl border bg-white px-3 py-2 text-sm hover:bg-gray-50";
}

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams?: {
    q?: string;
    status?: string;
    paymentStatus?: string;
    view?: string;
    error?: string;
    order?: string;
  };
}) {
  const q = (searchParams?.q || "").trim();
  const status = (searchParams?.status || "").trim();
  const paymentStatus = (searchParams?.paymentStatus || "").trim();
  const view = normalizeView((searchParams?.view || "active").trim());
  const error = (searchParams?.error || "").trim();
  const orderNumber = (searchParams?.order || "").trim();

  const where: any = {};
  if (view === "active") where.archivedAt = null;
  if (view === "archive") where.archivedAt = { not: null };
  if (status) where.status = status;
  if (paymentStatus) where.paymentStatus = paymentStatus;

  if (q) {
    where.OR = [
      { orderNumber: { contains: q, mode: "insensitive" } },
      { phone: { contains: q, mode: "insensitive" } },
      { customerName: { contains: q, mode: "insensitive" } },
    ];
  }

  const orders = await prisma.order.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      orderNumber: true,
      customerName: true,
      phone: true,
      totalAmount: true,
      status: true,
      paymentStatus: true,
      archivedAt: true,
      createdAt: true,
      _count: { select: { items: true } },
    },
  });

  const statuses = ["", "NEW", "CONFIRMED", "PACKING", "SHIPPED", "DONE", "CANCELED"];
  const returnTo = `/admin/orders?view=${view}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-xl font-bold">Заказы</h1>
          <div className="text-sm text-gray-500">Показано: {orders.length}</div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Link className={viewClass(view === "active")} href="/admin/orders?view=active">
            Рабочие
          </Link>
          <Link className={viewClass(view === "archive")} href="/admin/orders?view=archive">
            Архив
          </Link>
          <Link className={viewClass(view === "all")} href="/admin/orders?view=all">
            Все
          </Link>
        </div>
      </div>

      <form className="flex flex-col sm:flex-row sm:flex-wrap gap-2">
        <input type="hidden" name="view" value={view} />
        <input
          name="q"
          defaultValue={q}
          className="border rounded-xl px-3 py-2 text-sm"
          placeholder="Поиск: номер / телефон / имя"
        />
        <select
          name="status"
          defaultValue={status}
          className="border rounded-xl px-3 py-2 text-sm bg-white"
        >
          {statuses.map((s) => (
            <option key={s} value={s}>
              {s ? statusLabel(s) : "Все статусы"}
            </option>
          ))}
        </select>
        <select
          name="paymentStatus"
          defaultValue={paymentStatus}
          className="border rounded-xl px-3 py-2 text-sm bg-white"
        >
          {["", "UNPAID", "DUE_ON_DELIVERY", "PENDING", "PAID", "REFUNDED"].map((s) => (
            <option key={s} value={s}>
              {s ? paymentStatusLabel(s) : "Вся оплата"}
            </option>
          ))}
        </select>
        <button className="px-3 py-2 rounded-xl bg-black text-white text-sm" type="submit">
          Найти
        </button>
      </form>

      {error === "payment_required" && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          Нельзя перевести заказ{orderNumber ? " " + orderNumber : ""} в сборку или отправку: сначала подтвердите оплату.
          После отметки «Оплачен» доступны следующие этапы обработки.
        </div>
      )}

      {error === "order_archived" && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Заказ{orderNumber ? " " + orderNumber : ""} находится в архиве. Сначала восстановите его, чтобы менять статус или оплату.
        </div>
      )}

      <div className="rounded-2xl border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="text-left p-3">Дата</th>
              <th className="text-left p-3">Номер</th>
              <th className="text-left p-3">Клиент</th>
              <th className="text-left p-3">Телефон</th>
              <th className="text-right p-3">Сумма</th>
              <th className="text-left p-3">Статус</th>
              <th className="text-left p-3">Оплата</th>
              <th className="text-right p-3">Позиции</th>
              <th className="text-right p-3">Действия</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id} className="border-t align-top">
                <td className="p-3 whitespace-nowrap">
                  {new Date(o.createdAt).toLocaleString("ru-RU")}
                  {o.archivedAt && (
                    <div className="mt-1 text-xs text-gray-500">
                      В архиве с {new Date(o.archivedAt).toLocaleString("ru-RU")}
                    </div>
                  )}
                </td>
                <td className="p-3">
                  <Link className="hover:underline font-semibold" href={`/admin/orders/${o.id}`}>
                    {o.orderNumber}
                  </Link>
                </td>
                <td className="p-3">{o.customerName}</td>
                <td className="p-3">{o.phone}</td>
                <td className="p-3 text-right whitespace-nowrap">
                  {o.totalAmount.toLocaleString("ru-RU")} ₸
                </td>
                <td className="p-3">{statusLabel(String(o.status))}</td>
                <td className="p-3">{paymentStatusLabel(String(o.paymentStatus))}</td>
                <td className="p-3 text-right">{o._count.items}</td>
                <td className="p-3 text-right whitespace-nowrap">
                  <form action={`/admin/orders/${o.id}/archive`} method="post">
                    <input type="hidden" name="action" value={o.archivedAt ? "restore" : "archive"} />
                    <input type="hidden" name="returnTo" value={returnTo} />
                    <button
                      className="rounded-xl border bg-white px-3 py-2 text-xs hover:bg-gray-50"
                      type="submit"
                    >
                      {o.archivedAt ? "Восстановить" : "В архив"}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
            {orders.length === 0 && (
              <tr>
                <td className="p-4 text-gray-500" colSpan={9}>
                  {view === "archive" ? "Архив пуст." : "Нет заказов по заданным фильтрам."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
