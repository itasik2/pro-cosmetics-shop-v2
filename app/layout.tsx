import "./globals.css";
import type { Metadata } from "next";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import Providers from "./providers";

export const metadata: Metadata = {
  title: "Pro Cosmetics Shop",
  description: "Профессиональная косметика. Быстро, честно, без блёсток.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>
        <Providers>
          <Navbar />
          <main className="container py-8">{children}</main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
