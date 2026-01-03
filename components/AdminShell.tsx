// components/AdminShell.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { signOut } from "next-auth/react";

export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  const link = (href: string, label: string) => {
    const active = pathname.startsWith(href);
    return (
      <Link
        href={href}
        className={
          "px-3 py-1 rounded-full text-sm " +
          (active ? "bg-black text-white" : "text-gray-700 hover:bg-gray-100")
        }
      >
        {label}
      </Link>
    );
  };

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* Внутреннее меню админки */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3 mb-2">
        <div className="flex flex-wrap gap-2">
          {link("/admin/products", "Товары")}
          {link("/admin/blog", "Блог")}
          {link("/admin/orders", "Заказы")}
          {link("/admin/reviews", "Отзывы")}
          {link("/admin/brands", "Бренды")}
          {link("/admin/settings", "Настройки сайта")}
        </div>

        <button
          type="button"
          className="px-3 py-1 rounded-full text-sm border hover:bg-gray-50"
          onClick={() => signOut({ callbackUrl: "/admin" })}
        >
          Выйти
        </button>
      </div>

      {/* Контент конкретной страницы админки */}
      <div>{children}</div>
    </div>
  );
}
