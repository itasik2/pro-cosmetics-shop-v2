// app/checkout/success/page.tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { isHalykEpayConfigured } from "@/lib/halykEpay";
import { getCustomerMessengerAvailability, telegramOrderConnectUrl } from "@/lib/messenger";
import { requestLocale } from "@/lib/i18nServer";
import { uiText, localizedHref } from "@/lib/i18n";

export default async function CheckoutSuccessPage(
  props: {
    searchParams?: Promise<{ order?: string; token?: string; channel?: string }>;
  }
) {
  const locale = await requestLocale();
  const t = (russian: string) => uiText(locale, russian);
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

  const availability = getCustomerMessengerAvailability();
  const channelMessage =
    channel === "WHATSAPP"
      ? availability.whatsapp
        ? t("Информация по заказу будет отправляться в WhatsApp на указанный номер.")
        : t("Автоматические уведомления в WhatsApp пока недоступны. Магазин получил заказ и сможет связаться с вами по указанному номеру. Сохраните ссылку на страницу заказа.")
      : channel === "TELEGRAM"
        ? telegramUrl
          ? t("Чтобы получать автоматические уведомления, один раз подключите заказ к Telegram-боту. В боте нажмите Start, затем «Поделиться номером телефона». Номер должен совпадать с указанным в заказе.")
          : t("Telegram выбран для уведомлений, но бот магазина ещё не настроен.")
        : t("Проверьте email: туда придёт защищённая ссылка на страницу заказа и дальнейшие уведомления.");

  return (
    <div className="max-w-2xl mx-auto py-10 space-y-4">
      <h1 className="text-2xl font-bold">{t("Заказ оформлен")}</h1>

      {order ? (
        <div className="rounded-2xl border p-4 bg-white">
          <div className="text-sm text-gray-500">{t("Номер заказа")}</div>
          <div className="text-xl font-bold">{order}</div>
          <div className="text-sm text-gray-600 mt-2">
            {channelMessage} {t("Перейдите на страницу заказа для оплаты.")}
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {accessUrl ? (
              <Link
                href={accessUrl}
                className="inline-flex rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white"
              >
                {t("Перейти к оплате")}
              </Link>
            ) : null}

            {telegramUrl ? (
              <a
                href={telegramUrl}
                className="inline-flex rounded-xl border bg-white px-4 py-2 text-sm font-semibold hover:bg-gray-50"
              >
                {t("Подключить Telegram")}
              </a>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="text-sm text-gray-600">{t("Спасибо за заказ.")}</div>
      )}

      <div className="flex gap-2">
        <Link
          href={localizedHref("/shop", locale)}
          className="px-3 py-2 rounded-xl border bg-white hover:bg-gray-50"
        >
          {t("В каталог")}
        </Link>
        <Link
          href={localizedHref("/", locale)}
          className="px-3 py-2 rounded-xl border bg-white hover:bg-gray-50"
        >
          {t("На главную")}
        </Link>
      </div>
    </div>
  );
}