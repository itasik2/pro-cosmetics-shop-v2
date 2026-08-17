import { notFound } from "next/navigation";
import PaymentReportForm from "./PaymentReportForm";
import { hashOrderAccessToken } from "@/lib/orderAccess";
import { getPaymentInstructions } from "@/lib/paymentInstructions";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function statusLabel(value: string) {
  const labels: Record<string, string> = {
    NEW: "Новый",
    CONFIRMED: "Подтверждён",
    PACKING: "Сборка",
    SHIPPED: "Отправлен",
    DONE: "Завершён",
    CANCELED: "Отменён",
  };
  return labels[value] || value;
}

function paymentLabel(value: string) {
  const labels: Record<string, string> = {
    UNPAID: "Ожидает оплаты",
    PENDING: "Оплата на проверке",
    PAID: "Оплачен",
    REFUNDED: "Возврат",
    DUE_ON_DELIVERY: "Оплата при получении",
  };
  return labels[value] || value;
}

export default async function GuestOrderPage({
  params,
}: {
  params: { token: string };
}) {
  const token = String(params.token || "").trim();
  const order = await prisma.order.findUnique({
    where: { customerAccessTokenHash: hashOrderAccessToken(token) },
    include: { items: { orderBy: { createdAt: "asc" } } },
  });

  if (!order) notFound();

  const instructions = getPaymentInstructions();
  const isPrepayment = order.paymentMethod === "KASPI_TRANSFER";
  const canReport =
    isPrepayment &&
    order.status !== "CANCELED" &&
    order.status !== "DONE" &&
    ["UNPAID", "PENDING"].includes(order.paymentStatus);

  return (
    <div className="mx-auto max-w-3xl space-y-5 py-8">
      <div>
        <div className="text-sm text-gray-500">Страница заказа</div>
        <h1 className="text-3xl font-bold">{order.orderNumber}</h1>
        <div className="mt-2 flex flex-wrap gap-2 text-sm">
          <span className="rounded-full bg-gray-100 px-3 py-1">
            Статус: {statusLabel(String(order.status))}
          </span>
          <span className="rounded-full bg-amber-100 px-3 py-1">
            Оплата: {paymentLabel(String(order.paymentStatus))}
          </span>
        </div>
      </div>

      <div className="rounded-2xl border p-4">
        <div className="mb-3 font-semibold">Состав заказа</div>
        <div className="space-y-2 text-sm">
          {order.items.map((item) => (
            <div key={item.id} className="flex items-start justify-between gap-3 border-b pb-2 last:border-0">
              <div>
                <div className="font-medium">{item.title}</div>
                <div className="text-gray-500">{item.qty} шт.</div>
              </div>
              <div className="whitespace-nowrap font-semibold">
                {item.lineTotal.toLocaleString("ru-RU")} ₸
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 flex justify-between border-t pt-3 font-bold">
          <span>Итого</span>
          <span>{order.totalAmount.toLocaleString("ru-RU")} ₸</span>
        </div>
      </div>

      {isPrepayment && order.status !== "CANCELED" ? (
        <div className="space-y-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <div>
            <h2 className="text-lg font-bold">Оплата заказа</h2>
            <p className="mt-1 text-sm text-amber-900">
              Переведите точную сумму на единый бизнес-реквизит. После перевода нажмите «Я оплатил» — менеджер проверит оплату вручную.
            </p>
          </div>

          {order.paymentDueAt ? (
            <div className="text-sm font-semibold text-amber-900">
              Оплатить до: {new Date(order.paymentDueAt).toLocaleString("ru-RU")}
            </div>
          ) : (
            <div className="text-sm text-amber-900">
              Срок оплаты появится после подтверждения заказа менеджером.
            </div>
          )}

          {instructions.hasInstructions ? (
            <div className="space-y-2 rounded-xl bg-white/70 p-3 text-sm">
              {instructions.recipientName ? (
                <div><span className="text-gray-600">Получатель:</span> {instructions.recipientName}</div>
              ) : null}
              {instructions.kaspiPhone ? (
                <div><span className="text-gray-600">Kaspi:</span> {instructions.kaspiPhone}</div>
              ) : null}
              {instructions.paymentLink ? (
                <div>
                  <span className="text-gray-600">Ссылка:</span>{" "}
                  <a className="break-all underline" href={instructions.paymentLink} target="_blank" rel="noreferrer">
                    {instructions.paymentLink}
                  </a>
                </div>
              ) : null}
              {instructions.note ? <div className="whitespace-pre-wrap">{instructions.note}</div> : null}
              {instructions.qrImageUrl ? (
                <img src={instructions.qrImageUrl} alt="QR для оплаты" className="max-h-64 rounded-xl border" />
              ) : null}
            </div>
          ) : (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              Реквизиты оплаты ещё не настроены. Дождитесь сообщения менеджера.
            </div>
          )}

          {canReport ? <PaymentReportForm token={token} paymentStatus={String(order.paymentStatus)} /> : null}
        </div>
      ) : null}

      <div className="text-sm text-gray-500">
        Ссылка персональная: не передавайте её третьим лицам.
      </div>
    </div>
  );
}
