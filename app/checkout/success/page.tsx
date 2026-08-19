// app/checkout/success/page.tsx
import Link from "next/link";

function channelText(channel: string) {
  if (channel === "WHATSAPP") {
    return "Менеджер свяжется с вами в WhatsApp для подтверждения заказа и отправки информации по оплате.";
  }
  if (channel === "TELEGRAM") {
    return "Менеджер свяжется с вами в Telegram для подтверждения заказа и отправки информации по оплате.";
  }
  return "Проверьте email: там будет защищённая ссылка на страницу заказа. Менеджер подтвердит заказ и отправит реквизиты для оплаты.";
}

export default function CheckoutSuccessPage({
  searchParams,
}: {
  searchParams?: { order?: string; token?: string; channel?: string };
}) {
  const order = (searchParams?.order || "").trim();
  const token = (searchParams?.token || "").trim();
  const channel = (searchParams?.channel || "EMAIL").trim().toUpperCase();
  const accessUrl = token ? `/order/${encodeURIComponent(token)}` : "";

  return (
    <div className="max-w-2xl mx-auto py-10 space-y-4">
      <h1 className="text-2xl font-bold">Заказ оформлен</h1>

      {order ? (
        <div className="rounded-2xl border p-4 bg-white">
          <div className="text-sm text-gray-500">Номер заказа</div>
          <div className="text-xl font-bold">{order}</div>
          <div className="text-sm text-gray-600 mt-2">{channelText(channel)}</div>
          {accessUrl ? (
            <Link href={accessUrl} className="mt-3 inline-flex rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white">
              Открыть страницу заказа
            </Link>
          ) : null}
        </div>
      ) : (
        <div className="text-sm text-gray-600">Спасибо за заказ. Мы свяжемся с вами.</div>
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
