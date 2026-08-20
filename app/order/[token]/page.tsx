import { notFound } from "next/navigation";
import HalykPayButton from "./HalykPayButton";
import PaymentReportForm from "./PaymentReportForm";
import { isHalykEpayConfigured } from "@/lib/halykEpay";
import { hashOrderAccessToken } from "@/lib/orderAccess";
import { getPaymentInstructions } from "@/lib/paymentInstructions";
import { telegramOrderConnectUrl } from "@/lib/messenger";
import { prisma } from "@/lib/prisma";
import { SITE_WHATSAPP_URL } from "@/lib/siteConfig";

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

function whatsappOrderUrl(orderNumber: string) {
  if (!SITE_WHATSAPP_URL) return "";
  try {
    const url = new URL(SITE_WHATSAPP_URL);
    url.searchParams.set(
      "text",
      `Здравствуйте! Пишу по заказу ${orderNumber}.`,
    );
    return url.toString();
  } catch {
    return SITE_WHATSAPP_URL;
  }
}

export default async function GuestOrderPage({
  params,
  searchParams,
}: {
  params: { token: string };
  searchParams?: { payment?: string };
}) {
  const token = String(params.token || "").trim();
  const order = await prisma.order.findUnique({
    where: { customerAccessTokenHash: hashOrderAccessToken(token) },
    include: { items: { orderBy: { createdAt: "asc" } } },
  });

  if (!order) notFound();

  const instructions = getPaymentInstructions();
  const isPrepayment = order.paymentMethod === "KASPI_TRANSFER";
  const paymentSettled =
    order.paymentStatus === "PAID" || order.paymentStatus === "REFUNDED";
  const paymentExpired = Boolean(
    order.paymentDueAt && order.paymentDueAt.getTime() < Date.now(),
  );
  const canReport =
    isPrepayment &&
    order.status !== "CANCELED" &&
    order.status !== "DONE" &&
    (order.paymentStatus === "UNPAID" || order.paymentStatus === "PENDING");
  const canHalykPay =
    isPrepayment &&
    order.status === "CONFIRMED" &&
    order.paymentStatus === "UNPAID" &&
    !paymentExpired &&
    isHalykEpayConfigured();

  const notificationChannel = String(order.notificationChannel || "").toUpperCase();
  const telegramConnectUrl =
    notificationChannel === "TELEGRAM"
      ? telegramOrderConnectUrl(order.orderNumber)
      : "";
  const telegramUrl =
    telegramConnectUrl && order.telegramChatId
      ? telegramConnectUrl.split("?")[0]
      : telegramConnectUrl;
  const whatsappUrl =
    notificationChannel === "WHATSAPP"
      ? whatsappOrderUrl(order.orderNumber)
      : "";

  const paymentReturn = String(searchParams?.payment || "");

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

      {paymentReturn === "success" ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          Оплата через Halyk ePay подтверждена банком.
        </div>
      ) : paymentReturn === "processing" ? (
        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
          Банк вернул вас в магазин. Статус платежа ещё обрабатывается; его можно проверить ниже.
        </div>
      ) : paymentReturn === "failed" ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          Halyk ePay не подтвердил оплату. Деньги не считаются полученными, можно повторить попытку или выбрать перевод на Kaspi.
        </div>
      ) : null}

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

      {telegramUrl || whatsappUrl ? (
        <div className="rounded-2xl border p-4">
          <h2 className="font-semibold">Связь по заказу</h2>
          <p className="mt-1 text-sm text-gray-600">
            {notificationChannel === "TELEGRAM"
              ? order.telegramChatId
                ? "Откройте чат с ботом, чтобы посмотреть уведомления по заказу."
                : "Подключите заказ к Telegram-боту, чтобы получать автоматические уведомления."
              : "Откройте WhatsApp магазина. Номер заказа уже будет подставлен в сообщение."}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {telegramUrl ? (
              <a
                href={telegramUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700"
              >
                {order.telegramChatId ? "Перейти в Telegram" : "Подключить Telegram"}
              </a>
            ) : null}
            {whatsappUrl ? (
              <a
                href={whatsappUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
              >
                Перейти в WhatsApp
              </a>
            ) : null}
          </div>
        </div>
      ) : null}

      {isPrepayment && order.status !== "CANCELED" ? (
        paymentSettled ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
            <h2 className="text-lg font-bold text-emerald-900">Оплата подтверждена</h2>
            <p className="mt-1 text-sm text-emerald-900">
              {order.paymentProvider === "HALYK_EPAY"
                ? "Платёж картой через Halyk ePay подтверждён автоматически."
                : "Оплата заказа подтверждена магазином."}
            </p>
          </div>
        ) : (
          <div className="space-y-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <div>
              <h2 className="text-lg font-bold">Оплата заказа</h2>
              {order.status === "CONFIRMED" ? (
                <p className="mt-1 text-sm text-amber-900">
                  Оплатите подтверждённый заказ картой через Halyk ePay или переводом на Kaspi.
                </p>
              ) : (
                <p className="mt-1 text-sm text-amber-900">
                  Способы оплаты станут доступны после подтверждения заказа менеджером.
                </p>
              )}
            </div>

            {order.paymentDueAt ? (
              <div className="text-sm font-semibold text-amber-900">
                Оплатить до:{" "}
                {new Date(order.paymentDueAt).toLocaleString("ru-RU", {
                  timeZone: "Asia/Almaty",
                })}
              </div>
            ) : (
              <div className="text-sm text-amber-900">
                Срок оплаты появится после подтверждения заказа менеджером.
              </div>
            )}

            {order.status === "CONFIRMED" && order.paymentStatus === "UNPAID" ? (
              <>
                {canHalykPay ? (
                  <div className="space-y-2 rounded-xl border border-emerald-200 bg-white p-3">
                    <div className="font-semibold">Оплата банковской картой</div>
                    <div className="text-sm text-gray-600">
                      Платёж проводится на защищённой странице Halyk ePay. Статус оплаты обновится автоматически после подтверждения банка.
                    </div>
                    <HalykPayButton token={token} amount={order.totalAmount} />
                  </div>
                ) : null}

                <div className="space-y-2 rounded-xl bg-white/70 p-3 text-sm">
                  <div className="font-semibold">
                    {canHalykPay ? "Или переводом на Kaspi" : "Перевод на Kaspi"}
                  </div>
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
                  {!instructions.hasInstructions ? (
                    <div className="text-red-800">
                      Реквизиты Kaspi ещё не настроены. Используйте доступную оплату картой или дождитесь сообщения менеджера.
                    </div>
                  ) : null}
                </div>
              </>
            ) : null}

            {order.paymentStatus === "PENDING" ? (
              <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
                Вы сообщили о переводе на Kaspi. Менеджер проверяет поступление оплаты.
              </div>
            ) : null}

            {canReport ? <PaymentReportForm token={token} paymentStatus={String(order.paymentStatus)} /> : null}
          </div>
        )
      ) : null}

      <div className="text-sm text-gray-500">
        Ссылка персональная: не передавайте её третьим лицам.
      </div>
    </div>
  );
}
