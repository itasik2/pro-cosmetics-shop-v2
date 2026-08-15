import Image from "next/image";
import Link from "next/link";
import {
  SITE_BRAND,
  SITE_CONTACT_EMAIL,
  SITE_CONTACT_LOCATION,
  SITE_CONTACT_PHONE,
  SITE_CONTACT_PHONE_HREF,
  SITE_WHATSAPP_URL,
} from "@/lib/siteConfig";
import { getPublicExternalLinks } from "@/lib/externalLinks";

const FOOTER_LINKS = [
  { href: "/shop", label: "Каталог" },
  { href: "/blog", label: "Полезные материалы" },
  { href: "/about", label: "О магазине" },
  { href: "/contacts", label: "Контакты" },
  { href: "/ask", label: "Задать вопрос" },
] as const;

export default async function Footer() {
  const externalLinks = await getPublicExternalLinks();
  const socialLinks = externalLinks.filter((link) => link.kind === "SOCIAL");
  const marketplaceLinks = externalLinks.filter(
    (link) => link.kind === "MARKETPLACE",
  );

  return (
    <footer className="mt-12 border-t border-[var(--color-border)] bg-white/95 text-sm text-gray-600">
      <div className="container grid gap-8 py-10 md:grid-cols-[1.35fr_0.8fr_1fr]">
        <div className="max-w-lg">
          <Link href="/" className="inline-flex" aria-label={`${SITE_BRAND} — на главную`}>
            <Image
              src="/brand/footer-logo.svg"
              alt={SITE_BRAND}
              width={180}
              height={60}
              className="h-11 w-auto"
            />
          </Link>
          <p className="mt-4 leading-6">
            Профессиональная косметика для продуманного домашнего ухода.
            Помогаем понять назначение средства, подобрать его под потребности кожи
            и правильно включить в ежедневную схему.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <span className="accent-badge rounded-full px-3 py-1 text-xs font-semibold">
              Доставка по Казахстану
            </span>
            <span className="accent-badge rounded-full px-3 py-1 text-xs font-semibold">
              Понятные карточки товаров
            </span>
          </div>
        </div>

        <div>
          <h2 className="font-semibold text-gray-950">Покупателям</h2>
          <nav className="mt-3 flex flex-col items-start gap-2" aria-label="Навигация в подвале">
            {FOOTER_LINKS.map((link) => (
              <Link key={link.href} href={link.href} className="hover:text-gray-950 hover:underline">
                {link.label}
              </Link>
            ))}
          </nav>
        </div>

        <div>
          <h2 className="font-semibold text-gray-950">Связаться с нами</h2>
          <div className="mt-3 space-y-2">
            <a href={SITE_CONTACT_PHONE_HREF} className="block font-semibold text-gray-900 hover:underline">
              {SITE_CONTACT_PHONE}
            </a>
            {SITE_CONTACT_EMAIL ? (
              <a href={`mailto:${SITE_CONTACT_EMAIL}`} className="block hover:text-gray-950 hover:underline">
                {SITE_CONTACT_EMAIL}
              </a>
            ) : null}
            <p>{SITE_CONTACT_LOCATION}</p>
          </div>
          <div className="mt-4 space-y-3">
            {SITE_WHATSAPP_URL || socialLinks.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {SITE_WHATSAPP_URL ? (
                  <a
                    href={SITE_WHATSAPP_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-secondary text-xs"
                  >
                    WhatsApp
                  </a>
                ) : null}
                {socialLinks.map((link) => (
                  <a
                    key={link.id}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-secondary text-xs"
                  >
                    {link.label}
                  </a>
                ))}
              </div>
            ) : null}

            {marketplaceLinks.length > 0 ? (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
                  Мы на маркетплейсах
                </p>
                <div className="flex flex-wrap gap-2">
                  {marketplaceLinks.map((link) => (
                    <a
                      key={link.id}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer nofollow sponsored"
                      className="btn-secondary text-xs"
                    >
                      {link.label}
                    </a>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="border-t border-[var(--color-border)]">
        <div className="container flex flex-col gap-2 py-4 text-xs text-gray-500 sm:flex-row sm:items-center sm:justify-between">
          <span>© {new Date().getFullYear()} {SITE_BRAND}. Все права защищены.</span>
          <span>
            Информация на сайте не заменяет консультацию специалиста. Не является публичной офертой.
          </span>
          <Link href="/admin" className="text-gray-400 hover:text-gray-700">
            Для сотрудников
          </Link>
        </div>
      </div>
    </footer>
  );
}
