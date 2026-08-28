// app/checkout/success/page.tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { isHalykEpayConfigured } from "@/lib/halykEpay";
import { telegramOrderConnectUrl } from "@/lib/messenger";

export default async function CheckoutSuccessPage(
  props: {
    searchParams?: Promise<{ order?: string; token?: string; channel?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const order = (searchParams?.order || "").trim();
  const token = (searchParams?.token || "").trim();
  const channel = (searchParams?.channel || "EMAIL").trim().toUpperCase();

  if (token && isHalykEpayConfigured()) {
    redirect(`/order/${encodeURIComponent(token)}?startPayment=halyk`);
  }

  const accessUrl = token ? `/order/${encodeURIComponent(token)}` : "";
  const telegramUrl =
    channel === "TELEGRAM" && order ? telegramOrderConnectUrl(order) : "";

  const channelMessage =
    channel === "WHATSAPP"
      ? "Информация по заказу будет отправляться в WhatsApp на указанный номер."
      : channel === "TELEGRAM"
        ? telegramUrl
          ? "Чтобы получать автоматические уведомления, один раз подключите заказ к Telegram-боту. В боте нажмите Start, затем «Поделиться номером телефона». Номер должен совпадать с указанным в заказе."
          : "Telegram выбран для уведомлений, но бот магазина ещё не настроен."
        : "Проверьте email: туда придёт защищённая ссылка на страницу заказа и дальнейшие уведомления.";

  return (
    <div className="max-w-2xl mx-auto py-10 space-y-4">
      <h1 className="text-2xl font-bold">Заказ оформлен</h1>

      {order ? (
        <div className="rounded-2xl border p-4 bg-white">
          <div className="text-sm text-gray-500">Номер заказа</div>
          <div className="text-xl font-bold">{order}</div>
          <div className="text-sm text-gray-600 mt-2">
            {channelMessage} Перейдите на страницу заказа для оплаты.
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {accessUrl ? (
              <Link
                href={accessUrl}
                className="inline-flex rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white"
              >
                Перейти к оплате
              </Link>
            ) : null}

            {telegramUrl ? (
              <a
                href={telegramUrl}
                className="inline-flex rounded-xl border bg-white px-4 py-2 text-sm font-semibold hover:bg-gray-50"
              >
                Подключить Telegram
              </a>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="text-sm text-gray-600">Спасибо за заказ.</div>
      )}

      <div className="flex gap-2">
        <Link
          href="/shop"
          className="px-3 py-2 rounded-xl border bg-white hover:bg-gray-50"
        >
          В каталог
        </Link>
        <Link
          href="/"
          className="px-3 py-2 rounded-xl border bg-white hover:bg-gray-50"
        >
          На главную
        </Link>
      </div>
    </div>
  );
}