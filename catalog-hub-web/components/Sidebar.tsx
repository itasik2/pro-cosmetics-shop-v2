"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { LogoutButton } from "@/components/LogoutButton";

const items = [
  ["/", "Обзор", "⌂"],
  ["/catalog", "Каталог", "▦"],
  ["/categories", "Категории", "▤"],
  ["/import", "Импорт", "⇩"],
  ["/inventory", "Склад", "▣"],
  ["/orders", "Заказы", "▧"],
  ["/channels", "Каналы", "⇆"],
  ["/ai", "AI", "✦"],
  ["/media", "Медиа", "◫"],
  ["/changes", "Изменения", "⇄"],
  ["/repricing", "Репрайсер", "₸"],
  ["/settings", "Настройки", "⚙"],
] as const;

export function Sidebar({ organizationName, organizationId }: { organizationName: string; organizationId: string }) {
  const path = usePathname();
  const [navigatingTo, setNavigatingTo] = useState<string | null>(null);
  const nav=useRef<HTMLElement|null>(null);
  useEffect(() => setNavigatingTo(null), [path]);
  useEffect(()=>{
    if(!window.matchMedia("(max-width:760px)").matches)return;
    const container=nav.current,active=container?.querySelector<HTMLElement>('[aria-current="page"]');
    if(container&&active)container.scrollBy({left:active.getBoundingClientRect().left-container.getBoundingClientRect().left-(container.clientWidth-active.clientWidth)/2,behavior:"instant"});
  },[path]);

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">CH</div>
        <div>
          <strong>Catalog Hub</strong>
          <span>Product Operations</span>
        </div>
      </div>

      <nav ref={nav}>
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
        {organizationName}
        <small>{organizationId || "Организация не настроена"}</small>
        <LogoutButton />
      </div>
    </aside>
  );
}
