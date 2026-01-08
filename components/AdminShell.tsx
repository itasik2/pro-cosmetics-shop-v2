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
          "px-2 sm:px-3 py-1 rounded-full text-xs sm:text-sm whitespace-nowrap " +
          (active ? "bg-black text-white" : "text-gray-700 hover:bg-gray-100")
        }
      >
        {label}
      </Link>
    );
  };

  return (
    <div className="w-full px-2 sm:px-4 lg:px-6 py-5 sm:py-6 space-y-5 sm:space-y-6 min-w-0">
      {/* Внутреннее меню админки */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b pb-3 mb-2 min-w-0">
        <div className="flex flex-wrap gap-2 min-w-0">
          {link("/admin/products", "Товары")}
          {link("/admin/blog", "Блог")}
          {link("/admin/orders", "Заказы")}
          {link("/admin/reviews", "Отзывы")}
          {link("/admin/brands", "Бренды")}
          {link("/admin/settings", "Настройки сайта")}
        </div>

        <button
          type="button"
          className="px-3 py-1 rounded-full text-xs sm:text-sm border hover:bg-gray-50 self-start sm:self-auto"
          onClick={() => signOut({ callbackUrl: "/admin" })}
        >
          Выйти
        </button>
      </div>

      {/* Контент конкретной страницы админки */}
      <div className="min-w-0">{children}</div>
    </div>
  );
}
