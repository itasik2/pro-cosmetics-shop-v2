import {
  SITE_BRAND,
  SITE_CONTACT_EMAIL,
  SITE_CONTACT_LOCATION,
  SITE_CONTACT_PHONE,
  SITE_CONTACT_PHONE_HREF,
  SITE_WHATSAPP_URL,
} from "@/lib/siteConfig";
import { getPublicExternalLinks } from "@/lib/externalLinks";

export const metadata = {
  title: `Контакты – ${SITE_BRAND}`,
  description: `Связаться с ${SITE_BRAND}: помощь с выбором профессиональной косметики и вопросы по заказу.`,
};

export default async function ContactsPage() {
  const externalLinks = await getPublicExternalLinks();
  const socialLinks = externalLinks.filter((link) => link.kind === "SOCIAL");
  const marketplaceLinks = externalLinks.filter(
    (link) => link.kind === "MARKETPLACE",
  );

  return (
    <div className="space-y-8 py-4">
      <section className="site-panel overflow-hidden rounded-3xl p-7 md:p-10">
        <p className="site-eyebrow">Мы на связи</p>
        <h1 className="mt-3 max-w-3xl text-3xl font-bold tracking-tight md:text-5xl">
          Поможем с выбором и ответим на вопросы о заказе
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-7 text-gray-600 md:text-lg">
          Напишите или позвоните, если нужно уточнить назначение средства,
          наличие, способ применения или условия доставки по Казахстану.
        </p>
      </section>

      <div className="grid gap-5 md:grid-cols-2">
        <section className="site-panel rounded-3xl p-6 md:p-8">
          <h2 className="text-xl font-semibold">Контактные данные</h2>
          <div className="mt-5 space-y-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Телефон</p>
              <a href={SITE_CONTACT_PHONE_HREF} className="mt-1 block text-lg font-semibold hover:underline">
                {SITE_CONTACT_PHONE}
              </a>
            </div>
            {SITE_CONTACT_EMAIL ? (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Email</p>
                <a href={`mailto:${SITE_CONTACT_EMAIL}`} className="mt-1 block font-semibold hover:underline">
                  {SITE_CONTACT_EMAIL}
                </a>
              </div>
            ) : null}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Регион</p>
              <p className="mt-1">{SITE_CONTACT_LOCATION}</p>
            </div>
          </div>
        </section>

        <section className="site-panel-muted rounded-3xl p-6 md:p-8">
          <h2 className="text-xl font-semibold">Удобный способ связи</h2>
          <p className="mt-3 leading-6 text-gray-600">
            Для быстрого вопроса о товаре удобнее написать в WhatsApp. Если
            обращаетесь по заказу, укажите номер заказа и телефон получателя.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            {SITE_WHATSAPP_URL ? (
              <a href={SITE_WHATSAPP_URL} target="_blank" rel="noopener noreferrer" className="btn">
                Написать в WhatsApp
              </a>
            ) : null}
            {socialLinks.map((link) => (
              <a key={link.id} href={link.url} target="_blank" rel="noopener noreferrer" className="btn-secondary">
                {link.label}
              </a>
            ))}
          </div>
        </section>
      </div>

      {marketplaceLinks.length > 0 ? (
        <section className="site-panel rounded-3xl p-6 md:p-8">
          <p className="site-eyebrow">Другие площадки</p>
          <h2 className="mt-2 text-2xl font-semibold">Покупайте там, где вам удобно</h2>
          <p className="mt-3 max-w-2xl leading-6 text-gray-600">
            Перейдите на страницу нашего магазина на выбранном маркетплейсе,
            чтобы посмотреть доступные предложения и условия площадки.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            {marketplaceLinks.map((link) => (
              <a
                key={link.id}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer nofollow sponsored"
                className="btn-secondary"
              >
                {link.label}
              </a>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
