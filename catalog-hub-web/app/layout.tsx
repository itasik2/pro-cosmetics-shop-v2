import type { Metadata } from "next";
import "./globals.css";
import { Sidebar } from "@/components/Sidebar";

export const metadata: Metadata = {
  title: "Catalog Hub",
  description: "Управление каталогом, AI, медиа, ценами и каналами",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>
        <div className="shell">
          <Sidebar />
          <main className="main">
            <header className="topbar">
              <div>
                <span className="eyebrow">PROСOSMETICS · CATALOG OPERATIONS</span>
              </div>
              <div className="topbar-state">
                Состояние API — в разделе «Обзор»
              </div>
            </header>
            {(process.env.NODE_ENV === "development" || process.env.CATALOG_HUB_LOCAL_MODE === "true") && (
              <div role="status" className="local-dev-status">
                <strong>Локальная разработка</strong>
                {process.env.CATALOG_HUB_LOCAL_WRITE_ENABLED === "true"
                  ? " · запись через API включена — используйте тестовую базу"
                  : " · безопасный режим: изменения товаров и остатков заблокированы"}
              </div>
            )}
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
