"use client";

import { usePathname } from "next/navigation";
import { localizedHref, SITE_LOCALE_COOKIE, type SiteLocale } from "@/lib/i18n";
import { useSiteLocale, useUiText } from "@/components/LocaleProvider";

const LANGUAGES: Array<{ locale: SiteLocale; label: string; name: string }> = [
  { locale: "ru", label: "RU", name: "Русский" },
  { locale: "kk", label: "ҚАЗ", name: "Казахский" },
  { locale: "en", label: "EN", name: "Английский" },
];

/** A native link works even before JS hydration; JS additionally preserves filters. */
export default function LanguageSwitcher() {
  const pathname = usePathname() || "/";
  const activeLocale = useSiteLocale();
  const t = useUiText();

  return (
    <nav className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white p-1" aria-label={t("Выбор языка")}>
      {LANGUAGES.map((language) => (
        <a
          key={language.locale}
          href={localizedHref(pathname, language.locale)}
          hrefLang={language.locale === "kk" ? "kk-KZ" : language.locale === "ru" ? "ru-KZ" : "en"}
          lang={language.locale}
          title={t(language.name)}
          aria-current={activeLocale === language.locale ? "page" : undefined}
          className={"rounded-full px-2 py-1 text-[11px] font-semibold transition sm:text-xs " +
            (activeLocale === language.locale ? "bg-[var(--color-primary)] text-white" : "text-gray-700 hover:bg-gray-100")}
          onClick={(event) => {
            // Never leak tokens to another origin; all paths are local.
            event.preventDefault();
            const secure = window.location.protocol === "https:" ? "; Secure" : "";
            document.cookie = SITE_LOCALE_COOKIE + "=" + language.locale + "; Path=/; Max-Age=31536000; SameSite=Lax" + secure;
            window.location.assign(localizedHref(pathname + window.location.search + window.location.hash, language.locale));
          }}
        >
          {language.label}
        </a>
      ))}
    </nav>
  );
}
