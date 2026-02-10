// components/Footer.tsx
import Link from "next/link";
import { SITE_BRAND } from "@/lib/siteConfig";

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
      aria-label={label}
      title={label}
      className={[
        // форма
        "inline-flex items-center justify-center w-8 h-8 rounded-full border transition",
        // цвет иконки (через currentColor)
        "text-gray-500 hover:text-gray-900",
        // рамка
        "border-gray-300 hover:border-gray-500",
      ].join(" ")}
    >
      {children}
    </a>
  );
}

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 32 32"
      className={className || "w-4 h-4"}
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M16.001 3C9.383 3 4 8.383 4 15c0 2.64.86 5.09 2.33 7.08L4 29l7.18-2.3A11.93 11.93 0 0016 27c6.617 0 12-5.383 12-12S22.618 3 16.001 3zm0 21.75c-2.24 0-4.34-.65-6.12-1.78l-.44-.27-4.26 1.36 1.39-4.14-.29-.43A9.72 9.72 0 016.25 15c0-5.38 4.38-9.75 9.75-9.75S25.75 9.62 25.75 15 21.38 24.75 16 24.75zm5.36-7.27c-.29-.15-1.72-.85-1.99-.95-.27-.1-.46-.15-.66.15-.2.29-.76.95-.93 1.14-.17.2-.34.22-.63.07-.29-.15-1.22-.45-2.33-1.43-.86-.77-1.44-1.72-1.61-2.01-.17-.29-.02-.45.13-.6.14-.14.29-.34.44-.51.15-.17.2-.29.29-.48.1-.2.05-.37-.02-.52-.07-.15-.66-1.6-.91-2.19-.24-.58-.49-.5-.66-.51h-.57c-.2 0-.52.07-.8.37-.27.29-1.05 1.03-1.05 2.52 0 1.48 1.08 2.91 1.23 3.11.15.2 2.12 3.23 5.13 4.53.72.31 1.28.5 1.72.64.72.23 1.38.2 1.9.12.58-.09 1.72-.7 1.96-1.37.24-.66.24-1.23.17-1.37-.07-.14-.27-.22-.56-.37z" />
    </svg>
  );
}

export default function Footer() {
  // подставь реальные ссылки
  const instagramUrl = "https://instagram.com/your_profile";
  const telegramUrl = "https://t.me/your_channel";
  const whatsappUrl = "https://wa.me/7700XXXXXXX";
  const tiktokUrl = "https://www.tiktok.com/@your_profile";

  return (
    <footer className="border-t mt-10 text-sm text-gray-600 bg-white">
      <div className="container mx-auto py-5">
        {/* МОБИЛЬНАЯ ВЕРСИЯ */}
        <div className="flex flex-col gap-3 md:hidden">
          <div>
            <div className="font-semibold text-base">{SITE_BRAND}</div>
            <p>
              Магазин профессиональной косметики для домашнего ухода:
              понятные составы и честные описания.
            </p>
          </div>

          <div className="flex gap-2">
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
              <WhatsAppIcon className="w-4 h-4" />
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
        </div>

        {/* ДЕСКТОП/ПЛАНШЕТ */}
        <div className="hidden md:flex md:flex-row md:items-start md:justify-between md:gap-10">
          <div className="md:w-1/2 space-y-2 max-w-md">
            <div className="font-semibold text-base">{SITE_BRAND}</div>
            <p>
              Магазин профессиональной косметики для домашнего ухода. Подбираем
              рабочие средства без лишнего шума: понятные составы, честные
              описания и адекватные цены.
            </p>
          </div>

          <div className="md:w-1/2 grid grid-cols-3 gap-4">
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

            <div>
              <div className="font-semibold mb-2">Контакты</div>
              <div className="space-y-1">
                <div>Тел.: +7 (XXX) XXX-XX-XX</div>
                <div>Email: sales@vita-services.com</div>
                <div>Павлодар, Казахстан</div>
              </div>
            </div>

            <div>
              <div className="font-semibold mb-2">Мы в соцсетях</div>
              <div className="flex gap-2 mb-2">
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

                <SocialIcon href={whatsappUrl} label="WhatsApp">
                  <WhatsAppIcon className="w-4 h-4" />
                </SocialIcon>

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
            </div>
          </div>
        </div>
      </div>

      <div className="border-t">
        <div className="container mx-auto py-3 flex flex-col md:flex-row items-center justify-between gap-2 text-[11px] text-gray-500">
          <div>© {new Date().getFullYear()} {SITE_BRAND}. Все права защищены.</div>
          <div>
            Не является публичной офертой. Перед применением средств
            консультируйтесь со специалистом.
          </div>
        </div>
      </div>
    </footer>
  );
}
