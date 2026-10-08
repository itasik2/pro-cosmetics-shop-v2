"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  ["/", "Обзор", "⌂"],
  ["/catalog", "Каталог", "▦"],
  ["/import", "Импорт", "⇩"],
  ["/ai", "AI", "✦"],
  ["/media", "Медиа", "◫"],
  ["/changes", "Изменения", "⇄"],
  ["/settings", "Настройки", "⚙"],
] as const;

export function Sidebar() {
  const path = usePathname();

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
            <Link className={active ? "nav-item active" : "nav-item"} href={href} key={href}>
              <span className="nav-icon">{icon}</span>
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="sidebar-foot">
        <span className="status-dot" />
        ProCosmetics
        <small>org_procosmetics</small>
      </div>
    </aside>
  );
}
