"use client";

import { usePathname } from "next/navigation";
import { localizedHref, parseSiteLocale, SITE_LOCALE_COOKIE } from "@/lib/i18n";
import { useSiteLocale, useUiText } from "@/components/LocaleProvider";

const LANGUAGES = [
  { locale: "ru", label: "RU", name: "Русский" },
  { locale: "kk", label: "ҚАЗ", name: "Казахский" },
  { locale: "en", label: "EN", name: "Английский" },
] as const;

/** One native, keyboard-accessible selector instead of three wide header links. */
export default function LanguageSwitcher() {
  const pathname = usePathname() || "/";
  const activeLocale = useSiteLocale();
  const t = useUiText();

  return (
    <div className="relative shrink-0">
      <select
        id="site-language"
        aria-label={t("Выбор языка")}
        title={t("Выбор языка")}
        value={activeLocale}
        onChange={(event) => {
          const language = parseSiteLocale(event.target.value);
          if (language === activeLocale) return;
          const secure = window.location.protocol === "https:" ? "; Secure" : "";
          document.cookie =
            SITE_LOCALE_COOKIE + "=" + language + "; Path=/; Max-Age=31536000; SameSite=Lax" + secure;
          window.location.assign(
            localizedHref(pathname + window.location.search + window.location.hash, language),
          );
        }}
        className="h-9 w-[68px] cursor-pointer appearance-none rounded-full border border-[var(--color-border)] bg-white pl-2.5 pr-6 text-xs font-semibold text-gray-800 shadow-sm transition hover:border-gray-400 sm:w-[76px] sm:text-sm"
      >
        {LANGUAGES.map((language) => (
          <option key={language.locale} value={language.locale} lang={language.locale} title={t(language.name)}>
            {language.label}
          </option>
        ))}
      </select>
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-600"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </div>
  );
}
