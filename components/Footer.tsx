// components/Footer.tsx
import Link from "next/link";

export default function Footer() {
  return (
    <footer className="border-t mt-10">
      <div className="container mx-auto py-6 flex flex-col md:flex-row gap-6 justify-between text-sm text-gray-600">
        {/* Описание бренда */}
        <div>
          <div className="font-semibold">pro.cosmetics</div>
          <div>
            Магазин профессиональной косметики для домашнего ухода. Нормальные
            составы, честные описания и цены без магии маркетинга.
          </div>
        </div>

        {/* Навигация + контакты + соцсети */}
        <div className="flex flex-col md:flex-row gap-6">
          <div>
            <div className="font-semibold mb-1">Навигация</div>
            <div className="flex flex-col gap-1">
              <Link href="/shop">Каталог</Link>
              <Link href="/blog">Блог</Link>
              <Link href="/about">О нас</Link>
              <Link href="/contacts">Контакты</Link>
              <Link href="/ask">Q&A</Link>
            </div>
          </div>

          <div>
            <div className="font-semibold mb-1">Контакты</div>
            <div>Тел.: +7 (XXX) XXX-XX-XX</div>
            <div>Email: sales@vita-services.com</div>
            <div>Павлодар, Казахстан</div>
          </div>

          <div>
            <div className="font-semibold mb-1">Мы в соцсетях</div>
            <div className="flex flex-col gap-1">
              <a
                href="https://instagram.com/your_profile"
                target="_blank"
                rel="noreferrer"
              >
                Instagram
              </a>
              <a
                href="https://t.me/your_channel"
                target="_blank"
                rel="noreferrer"
              >
                Telegram
              </a>
              <a
                href="https://wa.me/7700XXXXXXX"
                target="_blank"
                rel="noreferrer"
              >
                WhatsApp
              </a>
              <a
                href="https://www.tiktok.com/@your_profile"
                target="_blank"
                rel="noreferrer"
              >
                TikTok
              </a>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
