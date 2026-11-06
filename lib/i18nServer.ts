import { headers } from "next/headers";
import { parseSiteLocale, type SiteLocale } from "@/lib/i18n";

/** Middleware forwards the requested URL locale through rewrites. */
export async function requestLocale(): Promise<SiteLocale> {
  const headerStore = await headers();
  return parseSiteLocale(headerStore.get("x-site-locale"));
}
