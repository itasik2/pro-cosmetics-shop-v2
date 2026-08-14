"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { getCart } from "@/lib/cartStorage";
import {
  SITE_CONTACT_PHONE,
  SITE_CONTACT_PHONE_HREF,
  SITE_WHATSAPP_URL,
} from "@/lib/siteConfig";

const NAV_LINKS = [
  { href: "/shop", label: "Каталог" },
  { href: "/blog", label: "Блог" },
  { href: "/about", label: "О нас" },
  { href: "/contacts", label: "Контакты" },
  { href: "/ask", label: "Вопросы" },
] as const;

export default function Navbar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [cartCount, setCartCount] = useState(0);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    const syncCart = () => setCartCount(getCart().length);
    syncCart();
    window.addEventListener("storage", syncCart);
    window.addEventListener("storage-sync", syncCart);
    return () => {
      window.removeEventListener("storage", syncCart);
      window.removeEventListener("storage-sync", syncCart);
    };
  }, []);

  const navLinkClass = (href: string) => {
    const active = pathname === href || pathname.startsWith(`${href}/`);
    return `rounded-lg px-2 py-2 text-sm font-medium transition ${
      active
        ? "bg-[var(--color-accent-soft)] text-[var(--color-accent-strong)]"
        : "text-gray-700 hover:bg-gray-100 hover:text-gray-950"
    }`;
  };

  const isCheckoutPage =
    pathname === "/checkout" || pathname.startsWith("/checkout/");

  return (
    <>
      <a
        href="#main-content"
        className="fixed left-4 top-3 z-[70] -translate-y-24 rounded-lg bg-white px-4 py-2 font-semibold shadow-lg focus:translate-y-0"
      >
        Перейти к содержанию
      </a>

      <header className="sticky top-0 z-50 border-b border-[var(--color-border)] bg-white/95 backdrop-blur">
        <div className="border-b border-[var(--color-border)] bg-[var(--color-surface-muted)]">
          <div className="container flex min-h-9 items-center justify-between gap-3 py-1 text-xs text-gray-600">
            <span className="truncate">
              Профессиональный уход с доставкой по Казахстану
            </span>
            <div className="flex shrink-0 items-center gap-3">
              {SITE_WHATSAPP_URL ? (
                <a
                  href={SITE_WHATSAPP_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="hidden font-semibold hover:text-gray-950 sm:inline"
                >
                  Помощь с выбором
                </a>
              ) : null}
              <a
                href={SITE_CONTACT_PHONE_HREF}
                className="font-semibold text-gray-800 hover:text-gray-950"
              >
                {SITE_CONTACT_PHONE}
              </a>
            </div>
          </div>
        </div>

        <div className="container flex min-h-16 items-center justify-between gap-2 py-2 sm:min-h-[76px] sm:gap-4 sm:py-3">
          <Link href="/" className="inline-flex shrink-0" aria-label="PRO COSMETICS — на главную">
            <Image
              src="/brand/header-logo.svg"
              alt="PRO COSMETICS"
              width={300}
              height={70}
              priority
              className="h-9 w-auto sm:h-12"
            />
          </Link>

          <nav className="hidden items-center gap-1 lg:flex" aria-label="Основная навигация">
            {NAV_LINKS.map((link) => (
              <Link key={link.href} href={link.href} className={navLinkClass(link.href)}>
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="flex shrink-0 items-center gap-2">
            {!isCheckoutPage ? (
              <Link
                href="/checkout"
                className="relative inline-flex h-8 min-h-8 w-8 items-center justify-center rounded-full border border-[var(--color-border)] bg-white p-0 text-sm font-semibold text-gray-800 hover:border-gray-400 sm:w-auto sm:px-3 sm:py-1"
                aria-label={`Корзина, позиций: ${cartCount}`}
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-4 w-4 sm:hidden"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  aria-hidden="true"
                >
                  <path d="M3 4h2l2.1 10.1a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.6L20 8H6" />
                  <circle cx="9.5" cy="19" r="1" />
                  <circle cx="17" cy="19" r="1" />
                </svg>
                <span className="hidden sm:inline">Корзина</span>
                {cartCount > 0 ? (
                  <span className="accent-badge absolute -right-1 -top-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-bold sm:static sm:ml-2 sm:h-auto sm:min-w-6 sm:px-1.5 sm:py-0.5 sm:text-xs">
                    {cartCount > 99 ? "99+" : cartCount}
                  </span>
                ) : null}
              </Link>
            ) : null}
            <button
              type="button"
              className="inline-flex min-h-8 items-center justify-center rounded-full bg-[var(--color-primary)] px-3 py-1 text-sm font-semibold text-white lg:hidden"
              onClick={() => setOpen((value) => !value)}
              aria-expanded={open}
              aria-controls="mobile-navigation"
            >
              {open ? "Закрыть" : "Меню"}
            </button>
          </div>
        </div>

        {open ? (
          <nav
            id="mobile-navigation"
            className="border-t border-[var(--color-border)] bg-white lg:hidden"
            aria-label="Мобильная навигация"
          >
            <div className="container grid gap-1 py-3">
              {NAV_LINKS.map((link) => (
                <Link key={link.href} href={link.href} className={navLinkClass(link.href)}>
                  {link.label}
                </Link>
              ))}
            </div>
          </nav>
        ) : null}
      </header>
    </>
  );
}
