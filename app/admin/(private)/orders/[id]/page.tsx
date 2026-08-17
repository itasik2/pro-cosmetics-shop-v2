// app/admin/(private)/orders/[id]/page.tsx
import Link from "next/link";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const statuses = ["NEW", "CONFIRMED", "PACKING", "SHIPPED", "DONE", "CANCELED"] as const;
const paymentStatuses = ["UNPAID", "DUE_ON_DELIVERY", "PENDING", "PAID", "REFUNDED"] as const;

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

function paymentMethodLabel(s: string) {
  return s === "KASPI_TRANSFER" ? "Перевод на Kaspi" : "Оплата при получении";
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
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
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

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <form
            action={`/admin/orders/${order.id}/status`}
            method="post"
            className="flex gap-2 items-center"
          >
            <select
              name="status"
              defaultValue={String(order.status)}
              className="border rounded-xl px-3 py-2 text-sm bg-white"
              aria-label="Статус заказа"
            >
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {statusLabel(s)}
                </option>
              ))}
            </select>
            <button className="px-3 py-2 rounded-xl bg-black text-white text-sm" type="submit">
              Сохранить статус
            </button>
          </form>

          <form
            action={`/admin/orders/${order.id}/status`}
            method="post"
            className="flex gap-2 items-center"
          >
            <select
              name="paymentStatus"
              defaultValue={String(order.paymentStatus)}
              className="border rounded-xl px-3 py-2 text-sm bg-white"
              aria-label="Статус оплаты"
            >
              {paymentStatuses.map((s) => (
                <option key={s} value={s}>
                  {paymentStatusLabel(s)}
                </option>
              ))}
            </select>
            <button className="px-3 py-2 rounded-xl border bg-white text-sm" type="submit">
              Сохранить оплату
            </button>
          </form>
        </div>
      </div>

      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm">
        {order.paymentMethod === "KASPI_TRANSFER"
          ? order.paymentStatus === "PAID" || order.paymentStatus === "REFUNDED"
            ? "Предоплата подтверждена: заказ можно отправлять."
            : "Для перевода на Kaspi сначала отметьте оплату как «Оплачен»; до этого отправка заблокирована."
          : order.paymentStatus === "PAID" || order.paymentStatus === "REFUNDED"
            ? "Оплата получена."
            : "Оплата при получении: отправка разрешена, но завершить заказ можно только после получения денег."}
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
          <div className="font-bold">Доставка и оплата</div>
          <div className="text-sm space-y-1">
            <div>
              <span className="text-gray-600">Тип:</span> {order.deliveryType === "delivery" ? "Доставка" : "Самовывоз"}
            </div>
            <div>
              <span className="text-gray-600">Адрес:</span> {order.address || "—"}
            </div>
            <div>
              <span className="text-gray-600">Способ оплаты:</span> {paymentMethodLabel(String(order.paymentMethod))}
            </div>
            <div>
              <span className="text-gray-600">Оплата:</span>{" "}
              <span className="font-semibold">{paymentStatusLabel(String(order.paymentStatus))}</span>
            </div>
            {order.paidAt && (
              <div>
                <span className="text-gray-600">Оплачено:</span>{" "}
                {new Date(order.paidAt).toLocaleString("ru-RU")}
              </div>
            )}
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
              <th className="text-right p-3">Количество</th>
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

      <div className="text-sm text-gray-600 space-y-1">
        <div>
          Статус заказа: <span className="font-semibold">{statusLabel(String(order.status))}</span>
        </div>
        {order.email && (
          <div>
            Уведомление клиенту:{" "}
            <span className="font-semibold">
              {order.customerNotificationStatus === "SENT"
                ? "отправлено"
                : order.customerNotificationStatus === "FAILED"
                  ? "ошибка отправки"
                  : "ожидает отправки"}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
