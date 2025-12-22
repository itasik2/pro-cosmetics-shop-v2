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

  return (
    <header className="border-b bg-white/70 backdrop-blur sticky top-0 z-50">
      <div className="container flex items-center justify-between py-3">
        <Link href="/" className="font-bold tracking-tight text-lg">
          pro.cosmetics
        </Link>

        <nav className="hidden md:flex gap-6 text-sm">
          <Link href="/shop">Каталог</Link>
          <Link href="/blog">Блог</Link>
          <Link href="/about">О нас</Link>
          <Link href="/contacts">Контакты</Link>
          <Link href="/ask">Q&amp;A</Link>

          {/* вместо "Админ" */}
          <Link href={adminHref}>
            {status === "loading" ? "…" : adminLabel}
          </Link>

          <Link href="/checkout">Корзина</Link>
        </nav>

        <button className="md:hidden btn" onClick={() => setOpen(!open)}>
          Меню
        </button>
      </div>

      {open && (
        <div className="md:hidden border-t">
          <div className="container py-2 flex flex-col gap-2 text-sm">
            <Link href="/shop">Каталог</Link>
            <Link href="/blog">Блог</Link>
            <Link href="/about">О нас</Link>
            <Link href="/contacts">Контакты</Link>
            <Link href="/ask">Q&amp;A</Link>

            {/* вместо "Админ" */}
            <Link href={adminHref}>
              {status === "loading" ? "…" : adminLabel}
            </Link>

            <Link href="/checkout">Корзина</Link>
          </div>
        </div>
      )}
    </header>
  );
}
