// app/contacts/page.tsx
import { SITE_BRAND } from "@/lib/siteConfig";
export const metadata = {
  title: `Контакты – ${SITE_BRAND}`,
  description:
    `Связаться с ${SITE_BRAND}: телефон, email и социальные сети.`,
};

export default function ContactsPage() {
  return (
    <div className="space-y-4 py-6">
      <h1 className="text-3xl font-bold">Контакты</h1>

      <div className="space-y-2 text-gray-700">
        <div>Телефон: +7 (XXX) XXX-XX-XX</div>
        <div>Email: sales@vita-services.com</div>
        <div>Адрес: Павлодар, Казахстан</div>
      </div>

      <div className="space-y-2">
        <h2 className="text-xl font-semibold">Мы в соцсетях</h2>
        <div className="flex flex-col gap-1 text-sm">
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
  );
}
