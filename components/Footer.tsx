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
                  <path
                    d="M5 19l1.1-3.3A7 7 0 1119 11a7 7 0 01-10.8 5.7L5 19z"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  {/* Трубка внутри */}
                  <path
                    d="M10.5 9.5c-.2-.5-.4-.5-.7-.5-.2 0-.4 0-.6.2-.2.3-.7.7-.7 1.7 0 1 .8 1.9.9 2 .1.1 1.5 2.4 3.7 3.2 1.9.7 2 0 2.3-.2.3-.2.5-.4.5-.7 0-.3.1-.5 0-.6-.1-.2-.4-.3-.7-.4-.3-.1-1.6-.8-1.8-.8-.2 0-.4-.1-.6.2-.2.3-.7.8-.9.9-.1.1-.3 0-.4 0-.1-.1-.8-.3-1.5-1-.5-.5-.8-1.2-.9-1.3 0-.1 0-.3.1-.4.1-.1.2-.3.3-.4.1-.1.1-.2.2-.3.1-.1.1-.2 0-.4-.1-.2-.6-1.5-.8-1.9z"
                    fill="currentColor"
                  />
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
