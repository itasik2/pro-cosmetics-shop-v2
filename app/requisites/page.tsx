import {
  SITE_BRAND,
  SITE_CONTACT_EMAIL,
  SITE_CONTACT_LOCATION,
  SITE_CONTACT_PHONE,
  SITE_CONTACT_PHONE_HREF,
} from "@/lib/siteConfig";
import { getStorePolicy } from "@/lib/storePolicy";

export const metadata = {
  title: `Реквизиты — ${SITE_BRAND}`,
  description: `Юридическая информация и контактные данные продавца ${SITE_BRAND}.`,
};

export default function RequisitesPage() {
  const policy = getStorePolicy();

  return (
    <div className="space-y-8 py-4">
      <section className="site-panel rounded-3xl p-7 md:p-10">
        <p className="site-eyebrow">Юридическая информация</p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight md:text-5xl">
          Реквизиты продавца
        </h1>
        <p className="mt-4 max-w-3xl leading-7 text-gray-600">
          Сайт {SITE_BRAND} принадлежит и обслуживается зарегистрированным
          индивидуальным предпринимателем в Республике Казахстан.
        </p>
      </section>

      <section className="site-panel rounded-3xl p-6 md:p-8">
        <dl className="grid gap-5 md:grid-cols-2">
          <div>
            <dt className="text-sm text-gray-500">Зарегистрированное наименование</dt>
            <dd className="mt-1 text-lg font-semibold text-gray-950">
              {policy.sellerName || 'ИП "Мир услуг"'}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-gray-500">Страна регистрации</dt>
            <dd className="mt-1 font-semibold text-gray-950">Республика Казахстан</dd>
          </div>
          <div>
            <dt className="text-sm text-gray-500">Сайт</dt>
            <dd className="mt-1 font-semibold text-gray-950">{SITE_BRAND}</dd>
          </div>
          <div>
            <dt className="text-sm text-gray-500">Регион</dt>
            <dd className="mt-1">{SITE_CONTACT_LOCATION}</dd>
          </div>
          <div>
            <dt className="text-sm text-gray-500">Телефон</dt>
            <dd className="mt-1">
              <a className="font-semibold hover:underline" href={SITE_CONTACT_PHONE_HREF}>
                {SITE_CONTACT_PHONE}
              </a>
            </dd>
          </div>
          {SITE_CONTACT_EMAIL ? (
            <div>
              <dt className="text-sm text-gray-500">Email</dt>
              <dd className="mt-1">
                <a className="font-semibold hover:underline" href={`mailto:${SITE_CONTACT_EMAIL}`}>
                  {SITE_CONTACT_EMAIL}
                </a>
              </dd>
            </div>
          ) : null}
        </dl>
      </section>

      <section className="site-panel-muted rounded-3xl p-6 md:p-8">
        <h2 className="text-xl font-semibold">О продавце</h2>
        <p className="mt-3 max-w-3xl leading-7 text-gray-600">
          Зарегистрированное наименование продавца указано в точности в форме,
          используемой в государственных регистрационных документах. Персональные
          идентификаторы и адрес места регистрации не публикуются на этой странице.
        </p>
      </section>
    </div>
  );
}
