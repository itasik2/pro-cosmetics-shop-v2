"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { uiText, type SiteLocale } from "@/lib/i18n";

const LocaleContext = createContext<SiteLocale>("ru");

export function LocaleProvider({ locale, children }: { locale: SiteLocale; children: ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useSiteLocale() { return useContext(LocaleContext); }
export function useUiText() {
  const locale = useSiteLocale();
  return useMemo(() => (russian: string) => uiText(locale, russian), [locale]);
}
