export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { load } from "cheerio";
import { z } from "zod";
import { requireAdmin } from "@/lib/adminGuard";

const SearchSchema = z.object({ q: z.string().trim().min(2).max(140) });

type MetadataValue = { value?: string | number | boolean };
type CommonsImageInfo = {
  thumburl?: string;
  thumbwidth?: number;
  thumbheight?: number;
  url?: string;
  descriptionurl?: string;
  mime?: string;
  extmetadata?: Record<string, MetadataValue>;
};
type CommonsPage = { pageid?: number; title?: string; imageinfo?: CommonsImageInfo[] };
type CommonsResponse = { query?: { pages?: CommonsPage[] } };

function plainText(value: unknown) {
  if (typeof value !== "string") return "";
  return load(value, null, false).text().replace(/\s+/g, " ").trim();
}

function safeExternalUrl(value: unknown) {
  if (typeof value !== "string") return "";
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    url.protocol = "https:";
    return url.toString();
  } catch {
    return "";
  }
}

const RUSSIAN_SEARCH_HINTS: Array<[RegExp, string]> = [
  [/пептид/i, "peptide skincare"],
  [/ретин|retinol/i, "retinol skincare"],
  [/ниац|niacinamide/i, "niacinamide skincare"],
  [/гиалур/i, "hyaluronic acid skincare"],
  [/витамин\s*[cс]/i, "vitamin c skincare"],
  [/чувствительн/i, "sensitive skin"],
  [/сух(ая|ой|ую|ость)/i, "dry skin"],
  [/жирн/i, "oily skin"],
  [/проблемн|акне/i, "acne prone skin"],
  [/увлаж/i, "skin moisturizer"],
  [/очищ/i, "facial cleansing"],
  [/омолаж|антивозраст|возрастн/i, "anti aging skincare"],
  [/крем/i, "face cream"],
  [/сыворот/i, "face serum"],
  [/тоник/i, "facial toner"],
  [/маск/i, "face mask skincare"],
  [/пилинг|кислот/i, "skin exfoliation"],
  [/солнц|spf/i, "sunscreen skincare"],
  [/пигмент/i, "hyperpigmentation skincare"],
  [/розаце|купероз/i, "rosacea skincare"],
  [/глаз/i, "eye cream skincare"],
  [/волос|шампун/i, "hair care cosmetics"],
  [/тел(о|а)|рук|ног/i, "body care cosmetics"],
];

function buildEnglishSearchQuery(query: string) {
  if (!/[а-яё]/i.test(query)) return "";
  for (const [pattern, term] of RUSSIAN_SEARCH_HINTS) {
    if (pattern.test(query)) return term;
  }
  return "skincare";
}

function buildCommonsApiUrl(query: string) {
  const apiUrl = new URL("https://commons.wikimedia.org/w/api.php");
  apiUrl.search = new URLSearchParams({
    action: "query",
    generator: "search",
    gsrsearch: query,
    gsrnamespace: "6",
    gsrlimit: "12",
    prop: "imageinfo",
    iiprop: "url|mime|extmetadata",
    iiurlwidth: "1200",
    iiextmetadatalanguage: "ru",
    iiextmetadatafilter:
      "ImageDescription|Artist|Credit|LicenseShortName|UsageTerms|AttributionRequired|LicenseUrl",
    format: "json",
    formatversion: "2",
  }).toString();
  return apiUrl;
}

export async function GET(req: Request) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  const parsed = SearchSchema.safeParse({ q: new URL(req.url).searchParams.get("q") || "" });
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_search_query" }, { status: 400 });
  }

  const searchQuery = buildEnglishSearchQuery(parsed.data.q) || parsed.data.q;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(buildCommonsApiUrl(searchQuery), {
      next: { revalidate: 3600 },
      headers: {
        Accept: "application/json",
        "User-Agent":
          "ProCosmeticsBlogImageSearch/1.0 (https://www.procosmetics.kz/contacts)",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      return NextResponse.json({ error: "image_search_unavailable" }, { status: 502 });
    }

    const data = (await response.json()) as CommonsResponse;
    const results = (data.query?.pages || [])
      .map((page) => {
        const info = page.imageinfo?.[0];
        const metadata = info?.extmetadata || {};
        const imageUrl = safeExternalUrl(info?.thumburl || info?.url);
        const sourceUrl = safeExternalUrl(info?.descriptionurl);
        const license =
          plainText(metadata.LicenseShortName?.value) || plainText(metadata.UsageTerms?.value);

        if (
          !info ||
          !imageUrl ||
          !sourceUrl ||
          !license ||
          !info.mime?.startsWith("image/") ||
          info.mime === "image/svg+xml"
        ) return null;

        return {
          id: String(page.pageid || imageUrl),
          title: plainText(page.title?.replace(/^File:/i, "")) || "Изображение",
          description: plainText(metadata.ImageDescription?.value),
          imageUrl,
          sourceUrl,
          credit:
            plainText(metadata.Artist?.value) ||
            plainText(metadata.Credit?.value) ||
            "Wikimedia Commons",
          license,
          licenseUrl: safeExternalUrl(metadata.LicenseUrl?.value),
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    return NextResponse.json({ results });
  } catch (error) {
    console.error("GET /api/posts/search-images error:", error);
    return NextResponse.json({ error: "image_search_unavailable" }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}
