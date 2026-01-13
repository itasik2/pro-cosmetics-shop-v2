// app/admin/(private)/orders/[id]/page.tsx
import Link from "next/link";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const statuses = ["NEW", "CONFIRMED", "PACKING", "SHIPPED", "DONE", "CANCELED"] as const;

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

export default async function AdminOrderDetailPage({ params }: { params: { id: string } }) {
  const order = await prisma.order.findUnique({
    where: { id: params.id },
    include: { items: { orderBy: { createdAt: "asc" } } },
  });

  if (!order) {
    return (
      <div className="space-y-3">
        <div className="text-red-600">Заказ не найден</div>
        <Link className="underline" href="/admin/orders">
          Назад
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-sm text-gray-500">
            <Link className="hover:underline" href="/admin/orders">
              Заказы
            </Link>{" "}
            / {order.orderNumber}
          </div>
          <h1 className="text-xl font-bold">{order.orderNumber}</h1>
          <div className="text-sm text-gray-600">
            {new Date(order.createdAt).toLocaleString("ru-RU")} •{" "}
            {order.totalAmount.toLocaleString("ru-RU")} ₸
          </div>
        </div>

        <form
          action={`/api/admin/orders/${order.id}/status`}
          method="post"
          className="flex gap-2 items-center"
        >
          <select
            name="status"
            defaultValue={String(order.status)}
            className="border rounded-xl px-3 py-2 text-sm bg-white"
          >
            {statuses.map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </select>
          <button className="px-3 py-2 rounded-xl bg-black text-white text-sm" type="submit">
            Сохранить
          </button>
        </form>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="rounded-2xl border p-4 space-y-2">
          <div className="font-bold">Клиент</div>
          <div className="text-sm">
            <div>
              <span className="text-gray-600">Имя:</span> {order.customerName}
            </div>
            <div>
              <span className="text-gray-600">Телефон:</span> {order.phone}
            </div>
            {order.email && (
              <div>
                <span className="text-gray-600">Email:</span> {order.email}
              </div>
            )}
          </div>
        </div>

        <div className="rounded-2xl border p-4 space-y-2">
          <div className="font-bold">Доставка</div>
          <div className="text-sm">
            <div>
              <span className="text-gray-600">Тип:</span> {order.deliveryType}
            </div>
            <div>
              <span className="text-gray-600">Адрес:</span> {order.address || "—"}
            </div>
            <div>
              <span className="text-gray-600">Комментарий:</span> {order.comment || "—"}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="text-left p-3">Позиция</th>
              <th className="text-right p-3">Цена</th>
              <th className="text-right p-3">Кол-во</th>
              <th className="text-right p-3">Сумма</th>
            </tr>
          </thead>
          <tbody>
            {order.items.map((it) => (
              <tr key={it.id} className="border-t">
                <td className="p-3">
                  <div className="font-semibold">{it.title}</div>
                  <div className="text-xs text-gray-500">{it.productId}</div>
                </td>
                <td className="p-3 text-right whitespace-nowrap">
                  {it.unitPrice.toLocaleString("ru-RU")} ₸
                </td>
                <td className="p-3 text-right">{it.qty}</td>
                <td className="p-3 text-right whitespace-nowrap">
                  {it.lineTotal.toLocaleString("ru-RU")} ₸
                </td>
              </tr>
            ))}
            <tr className="border-t bg-gray-50">
              <td className="p-3 font-bold" colSpan={3}>
                Итого
              </td>
              <td className="p-3 text-right font-bold whitespace-nowrap">
                {order.totalAmount.toLocaleString("ru-RU")} ₸
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="text-sm text-gray-600">
        Статус: <span className="font-semibold">{statusLabel(String(order.status))}</span>
      </div>
    </div>
  );
}
