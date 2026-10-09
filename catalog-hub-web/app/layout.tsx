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
                <span className="status-dot" />
                API подключён
              </div>
            </header>
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
