// components/Footer.tsx
import Link from "next/link";

export default function Footer() {
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

        {/* Правая половина: навигация, контакты, соцсети + SEO-блок */}
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

          {/* Соцсети + SEO-блок */}
          <div>
            <div className="font-semibold mb-2">Мы на связи</div>
            <div className="flex flex-col gap-1 mb-3">
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

            {/* Небольшой блок под SEO-инструменты / внутренние ссылки */}
            /* {/* <div className="text-[11px] text-gray-500 leading-snug none">
              {/* Здесь можно размещать микро-текст для SEO:
                  ключевые фразы, внутренние ссылки на важные категории,
                  акции, бренды и т.п. */}
              Популярные категории: уход за лицом, очищение, сыворотки,
              кремы против возрастных изменений.
            </div>  */} */
          </div>
        </div>
      </div>

      {/* Нижняя тонкая полоска */}
      <div className="border-t">
        <div className="container mx-auto py-3 flex flex-col md:flex-row items-center justify-between gap-2 text-[11px] text-gray-500">
          <div>© {new Date().getFullYear()} pro.cosmetics. Все права защищены.</div>
          <div>
            Не является публичной офертой. Перед применением средств
            консультируйтесь со специалистом.
          </div>
        </div>
      </div>
    </footer>
  );
}
