// components/Navbar.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";

export default function Navbar() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const { data: session, status } = useSession();

  const isAdmin = (session?.user as any)?.role === "admin";
  const adminHref = isAdmin ? "/admin/products" : "/admin";
  const adminLabel = isAdmin ? "Админка" : "Войти";

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const navLinkClass = (href: string) => {
    const isActive =
      href === "/" ? pathname === "/" : pathname.startsWith(href);

    return (
      "hover:underline " +
      (isActive ? "font-semibold text-gray-900" : "text-gray-700")
    );
  };

  return (
    <header className="border-b bg-white/70 backdrop-blur sticky top-0 z-50">
      <div className="container flex items-center justify-between py-3">
        <Link href="/" className="font-bold tracking-tight text-lg">
          {process.env.NEXT_PUBLIC_SITE_BRAND ?? "Shop"}
        </Link>


        <nav className="hidden md:flex gap-6 text-sm">
          {/* Новая кнопка */}
          <Link href="/" className={navLinkClass("/")}>
            Главная
          </Link>

          <Link href="/shop" className={navLinkClass("/shop")}>
            Каталог
          </Link>
          <Link href="/blog" className={navLinkClass("/blog")}>
            Блог
          </Link>
          <Link href="/about" className={navLinkClass("/about")}>
            О нас
          </Link>
          <Link href="/contacts" className={navLinkClass("/contacts")}>
            Контакты
          </Link>
          <Link href="/ask" className={navLinkClass("/ask")}>
            Q&amp;A
          </Link>

          {/* вместо "Админ" */}
          <Link href={adminHref} className={navLinkClass(adminHref)}>
            {status === "loading" ? "…" : adminLabel}
          </Link>

          <Link href="/checkout" className={navLinkClass("/checkout")}>
            Корзина
          </Link>
        </nav>

        <button className="md:hidden btn" onClick={() => setOpen(!open)}>
          Меню
        </button>
      </div>

      {open && (
        <div className="md:hidden border-t">
          <div className="container py-2 flex flex-col gap-2 text-sm">
            {/* Новая кнопка */}
            <Link href="/" className={navLinkClass("/")}>
              Главная
            </Link>

            <Link href="/shop" className={navLinkClass("/shop")}>
              Каталог
            </Link>
            <Link href="/blog" className={navLinkClass("/blog")}>
              Блог
            </Link>
            <Link href="/about" className={navLinkClass("/about")}>
              О нас
            </Link>
            <Link href="/contacts" className={navLinkClass("/contacts")}>
              Контакты
            </Link>
            <Link href="/ask" className={navLinkClass("/ask")}>
              Q&amp;A
            </Link>

            <Link href={adminHref} className={navLinkClass(adminHref)}>
              {status === "loading" ? "…" : adminLabel}
            </Link>

            <Link href="/checkout" className={navLinkClass("/checkout")}>
              Корзина
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
