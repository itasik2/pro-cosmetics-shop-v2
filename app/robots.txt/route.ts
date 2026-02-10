// app/robots.txt/route.ts
import { NextResponse } from "next/server";
import { getPublicBaseUrl } from "@/lib/siteConfig";

function getBaseUrl() {
  return getPublicBaseUrl();
}

export function GET() {
  const baseUrl = getBaseUrl();
  const host = baseUrl.replace(/^https?:\/\//, "");

  const body = `User-agent: *
Allow: /

# Закрываем служебные разделы
Disallow: /admin
Disallow: /api

Sitemap: ${baseUrl}/sitemap.xml
Host: ${host}
`;

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
