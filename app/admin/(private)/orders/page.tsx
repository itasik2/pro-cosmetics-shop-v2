// app/admin/(private)/orders/page.tsx
import Link from "next/link";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

function statusLabel(s: string) {
  const map: Record<string, string> = {
    NEW: "Новый",
    CONFIRMED: "Подтвержден",
    PACKING: "Сборка",
    SHIPPED: "Отправлен",
    DONE: "Завершен",
    CANCELED: "Отменен",
  };
  return map[s] || s;
}

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams?: { q?: string; status?: string };
}) {
  const q = (searchParams?.q || "").trim();
  const status = (searchParams?.status || "").trim();

  const where: any = {};
  if (status) where.status = status;

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
      createdAt: true,
      _count: { select: { items: true } },
    },
  });

  const statuses = ["", "NEW", "CONFIRMED", "PACKING", "SHIPPED", "DONE", "CANCELED"];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-bold">Заказы</h1>
          <div className="text-sm text-gray-500">Всего: {orders.length}</div>
        </div>

        <form className="flex flex-col sm:flex-row gap-2">
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
          <button className="px-3 py-2 rounded-xl bg-black text-white text-sm" type="submit">
            Найти
          </button>
        </form>
      </div>

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
              <th className="text-right p-3">Позиции</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id} className="border-t">
                <td className="p-3 whitespace-nowrap">
                  {new Date(o.createdAt).toLocaleString("ru-RU")}
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
                <td className="p-3 text-right">{o._count.items}</td>
              </tr>
            ))}
            {orders.length === 0 && (
              <tr>
                <td className="p-4 text-gray-500" colSpan={7}>
                  Нет заказов по заданным фильтрам.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
