// components/Footer.tsx
import Link from "next/link";

function SocialIcon({
  href,
  label,
  children,
}: {
  href: string;
  label: string;
  children: React.ReactNode;
}) {
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center justify-center w-8 h-8 rounded-full border border-gray-300 hover:border-gray-500 transition"
      aria-label={label}
    >
      {children}
    </a>
  );
}

export default function Footer() {
  // Подставь свои реальные ссылки
  const instagramUrl = "https://instagram.com/your_profile";
  const telegramUrl = "https://t.me/your_channel";
  const whatsappUrl = "https://wa.me/7700XXXXXXX";
  const tiktokUrl = "https://www.tiktok.com/@your_profile";

  return (
    <footer className="border-t mt-10 text-sm text-gray-600 bg-white">
      <div className="container mx-auto py-5 flex flex-col md:flex-row gap-6 md:gap-10 justify-between">
        {/* Левая половина: логотип + короткое описание */}
        <div className="md:w-1/2 space-y-2 max-w-md">
          <div className="font-semibold text-base">pro.cosmetics</div>
          <p>
            Магазин профессиональной косметики для домашнего ухода. Подбираем
            рабочие средства без лишнего шума: понятные составы, честные
            описания и адекватные цены.
          </p>
        </div>

        {/* Правая половина: навигация, контакты, соцсети */}
        <div className="md:w-1/2 grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Навигация */}
          <div>
            <div className="font-semibold mb-2">Разделы</div>
            <div className="flex flex-col gap-1">
              <Link href="/shop">Каталог</Link>
              <Link href="/blog">Блог</Link>
              <Link href="/about">О нас</Link>
              <Link href="/contacts">Контакты</Link>
              <Link href="/ask">Q&amp;A</Link>
            </div>
          </div>

          {/* Контакты */}
          <div>
            <div className="font-semibold mb-2">Контакты</div>
            <div className="space-y-1">
              <div>Тел.: +7 (XXX) XXX-XX-XX</div>
              <div>Email: sales@vita-services.com</div>
              <div>Павлодар, Казахстан</div>
            </div>
          </div>

          {/* Соцсети */}
          <div>
            <div className="font-semibold mb-2">Мы в соцсетях</div>
            <div className="flex gap-2 mb-2">
              {/* Instagram */}
              <SocialIcon href={instagramUrl} label="Instagram">
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  className="w-4 h-4"
                  fill="none"
                >
                  <rect
                    x="3"
                    y="3"
                    width="18"
                    height="18"
                    rx="5"
                    stroke="currentColor"
                    strokeWidth="1.6"
                  />
                  <circle
                    cx="12"
                    cy="12"
                    r="4"
                    stroke="currentColor"
                    strokeWidth="1.6"
                  />
                  <circle cx="17" cy="7" r="1" fill="currentColor" />
                </svg>
              </SocialIcon>

              {/* Telegram */}
              <SocialIcon href={telegramUrl} label="Telegram">
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  className="w-4 h-4"
                  fill="none"
                >
                  <path
                    d="M20.5 4.5L3.5 11.2c-.7.3-.7 1.3 0 1.5l4.5 1.6 1.8 4.7c.2.6 1 .7 1.4.1l2.4-3.3 4.1 3.1c.6.4 1.4.1 1.5-.6l1.8-13c.1-.7-.6-1.2-1.3-1z"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M8.5 13.5L18 7.5"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  />
                </svg>
              </SocialIcon>

              {/* WhatsApp */}
              <SocialIcon href={whatsappUrl} label="WhatsApp">
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  className="w-4 h-4"
                  fill="none"
                >
                  {/* Внешний круг + "хвостик" чата */}
                 <path d="M380.9 97.1C339 55.1 283.2 32 223.9 32c-122.4 0-222 99.6-222 222 0 39.1 10.2 77.3 29.6 111L0 480l117.7-30.9c32.4 17.7 68.9 27 106.1 27h.1c122.3 0 224.1-99.6 224.1-222 0-59.3-25.2-115-67.1-157zm-157 341.6c-33.2 0-65.7-8.9-94-25.7l-6.7-4-69.8 18.3L72 359.2l-4.4-7c-18.5-29.4-28.2-63.3-28.2-98.2 0-101.7 82.8-184.5 184.6-184.5 49.3 0 95.6 19.2 130.4 54.1 34.8 34.9 56.2 81.2 56.1 130.5 0 101.8-84.9 184.6-186.6 184.6zm101.2-138.2c-5.5-2.8-32.8-16.2-37.9-18-5.1-1.9-8.8-2.8-12.5 2.8-3.7 5.6-14.3 18-17.6 21.8-3.2 3.7-6.5 4.2-12 1.4-32.6-16.3-54-29.1-75.5-66-5.7-9.8 5.7-9.1 16.3-30.3 1.8-3.7 .9-6.9-.5-9.7-1.4-2.8-12.5-30.1-17.1-41.2-4.5-10.8-9.1-9.3-12.5-9.5-3.2-.2-6.9-.2-10.6-.2-3.7 0-9.7 1.4-14.8 6.9-5.1 5.6-19.4 19-19.4 46.3 0 27.3 19.9 53.7 22.6 57.4 2.8 3.7 39.1 59.7 94.8 83.8 35.2 15.2 49 16.5 66.6 13.9 10.7-1.6 32.8-13.4 37.4-26.4 4.6-13 4.6-24.1 3.2-26.4-1.3-2.5-5-3.9-10.5-6.6z"/></svg>
                </svg>
              </SocialIcon>


              {/* TikTok */}
              <SocialIcon href={tiktokUrl} label="TikTok">
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  className="w-4 h-4"
                  fill="none"
                >
                  <path
                    d="M14.5 5.5V14a3.5 3.5 0 11-3-3.5"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M14.5 5.5c.3.9 1.1 3 3.5 3.5"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </SocialIcon>
            </div>

            {/* маленький технический/SEO-текст, по желанию можно поменять или удалить */}
            <div className="text-[11px] text-gray-500 leading-snug">
              Популярные категории: уход за лицом, очищение, сыворотки, кремы
              против возрастных изменений.
            </div>
          </div>
        </div>
      </div>

      {/* Нижняя полоска */}
      <div className="border-t">
        <div className="container mx-auto py-3 flex flex-col md:flex-row items-center justify-between gap-2 text-[11px] text-gray-500">
          <div>
            © {new Date().getFullYear()} pro.cosmetics. Все права защищены.
          </div>
          <div>
            Не является публичной офертой. Перед применением средств
            консультируйтесь со специалистом.
          </div>
        </div>
      </div>
    </footer>
  );
}
