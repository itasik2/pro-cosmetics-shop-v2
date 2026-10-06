import Link from "next/link";
import { SITE_BRAND, SITE_CONTACT_PHONE, SITE_CONTACT_PHONE_HREF, SITE_WHATSAPP_URL, getPublicBaseUrl } from "@/lib/siteConfig";
import { getStorePolicy } from "@/lib/storePolicy";

export const dynamic = "force-dynamic";
export const metadata = {
  title: `Доставка и оплата — ${SITE_BRAND}`,
  description: "Условия доставки, оформление заказа, способы оплаты и связь с магазином.",
  alternates: { canonical: `${getPublicBaseUrl()}/delivery` },
};

export default function DeliveryPage() {
  const policy = getStorePolicy();
  return <div className="mx-auto max-w-3xl space-y-6 py-8">
    <h1 className="text-3xl font-bold">Доставка и оплата</h1>
    <section className="site-panel space-y-3 rounded-3xl p-6">
      <h2 className="text-xl font-semibold">Доставка по Казахстану</h2>
      <p className="whitespace-pre-line leading-7">{policy.deliveryTerms}</p>
      <p className="font-semibold">{policy.deliveryPrice === null ? "Сумма в корзине — стоимость товаров, без доставки." : `Доставка: ${policy.deliveryPrice === 0 ? "бесплатно" : `${policy.deliveryPrice.toLocaleString("ru-RU")} ₸`}. Стоимость включается в итог заказа.`}</p>
      {SITE_WHATSAPP_URL && <a href={SITE_WHATSAPP_URL} target="_blank" rel="noopener noreferrer" className="btn-secondary">Уточнить доставку в WhatsApp</a>}
      <a href={SITE_CONTACT_PHONE_HREF} className="block underline">{SITE_CONTACT_PHONE}</a>
    </section>
    <section className="site-panel space-y-3 rounded-3xl p-6">
      <h2 className="text-xl font-semibold">Как оформить и оплатить заказ</h2>
      <ol className="list-decimal space-y-2 pl-5 leading-7">
        <li>Добавьте товары и нужные объёмы в корзину.</li>
        <li>Укажите имя, телефон, адрес и канал уведомлений.</li>
        <li>Проверьте состав заказа и условия доставки.</li>
        <li>После оформления откройте страницу заказа. На ней отображаются доступные способы оплаты и реквизиты.</li>
      </ol>
      <p className="leading-7">При подключённом Halyk ePay доступна оплата картой. Перевод Kaspi выполняется по реквизитам на странице заказа; статус меняется после подтверждения оплаты.</p>
    </section>
    <section className="site-panel space-y-3 rounded-3xl p-6">
      <h2 className="text-xl font-semibold">Вопросы по получению и возврату</h2>
      <p className="whitespace-pre-line leading-7">{policy.returnsTerms || "Если заказ повреждён, состав не соответствует заказанному или возник другой вопрос по получению, свяжитесь с магазином и укажите номер заказа. Условия возврата уточните до покупки."}</p>
      <Link href="/contacts" className="inline-block underline">Контакты магазина</Link>
    </section>
  </div>;
}
