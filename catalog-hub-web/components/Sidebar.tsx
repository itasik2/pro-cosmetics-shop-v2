"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { LogoutButton } from "@/components/LogoutButton";

const items = [
  ["/", "Обзор", "⌂"],
  ["/catalog", "Каталог", "▦"],
  ["/import", "Импорт", "⇩"],
  ["/ai", "AI", "✦"],
  ["/media", "Медиа", "◫"],
  ["/changes", "Изменения", "⇄"],
  ["/repricing", "Репрайсер", "₸"],
  ["/settings", "Настройки", "⚙"],
] as const;

export function Sidebar() {
  const path = usePathname();
  const [navigatingTo, setNavigatingTo] = useState<string | null>(null);
  useEffect(() => setNavigatingTo(null), [path]);

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">CH</div>
        <div>
          <strong>Catalog Hub</strong>
          <span>Product Operations</span>
        </div>
      </div>

      <nav>
        {items.map(([href, label, icon]) => {
          const active = href === "/" ? path === "/" : path.startsWith(href);
          return (
            <Link
                className={active ? "nav-item active" : "nav-item"}
                href={href} key={href}
                prefetch={false}
                aria-current={active ? "page" : undefined}
                onClick={() => setNavigatingTo(active ? null : href)}
              >
              <span className="nav-icon">{icon}</span>
              {label}
              {navigatingTo === href && <span className="nav-wait" aria-hidden="true">…</span>}
            </Link>
          );
        })}
      </nav>
      <div className="nav-status" role="status" aria-live="polite">{navigatingTo ? "Открывается раздел…" : ""}</div>

      <div className="sidebar-foot">
        <span className="status-dot" />
        ProCosmetics
        <small>org_procosmetics</small>
        <LogoutButton />
      </div>
    </aside>
  );
}
