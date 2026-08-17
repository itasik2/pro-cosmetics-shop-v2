import type { Prisma } from "@prisma/client";
import { sendSiteMail } from "@/lib/mailer";
import { prisma } from "@/lib/prisma";
import { SITE_BRAND, SITE_KEY, getPublicBaseUrl } from "@/lib/siteConfig";

export type SiteCheckResult = {
  path: string;
  ok: boolean;
  statusCode: number | null;
  responseTimeMs: number;
  error: string | null;
};

export type SiteMonitorResult = {
  isHealthy: boolean;
  responseTimeMs: number;
  checks: SiteCheckResult[];
  error: string | null;
};

const TARGETS = [
  { path: "/", marker: "Профессиональная косметика" },
  { path: "/shop", marker: "Каталог" },
  { path: "/api/health", marker: '"ok":true' },
  { path: "/sitemap.xml", marker: "<urlset" },
] as const;

function buildTargetUrl(path: string) {
  const baseUrl = new URL(getPublicBaseUrl());
  if (baseUrl.protocol !== "https:" && baseUrl.hostname !== "localhost") {
    throw new Error("monitor_base_url_must_use_https");
  }
  return new URL(path, `${baseUrl.toString().replace(/\/$/, "")}/`).toString();
}

async function checkTarget(path: string, marker: string): Promise<SiteCheckResult> {
  const startedAt = Date.now();

  try {
    const response = await fetch(buildTargetUrl(path), {
      cache: "no-store",
      redirect: "follow",
      headers: {
        "User-Agent": `${SITE_BRAND}-monitor/1.0`,
      },
      signal: AbortSignal.timeout(12_000),
    });
    const body = await response.text();
    const markerFound = body.includes(marker);
    const ok = response.ok && markerFound;

    return {
      path,
      ok,
      statusCode: response.status,
      responseTimeMs: Date.now() - startedAt,
      error: ok
        ? null
        : !response.ok
          ? `http_${response.status}`
          : "expected_content_missing",
    };
  } catch (error) {
    return {
      path,
      ok: false,
      statusCode: null,
      responseTimeMs: Date.now() - startedAt,
      error:
        error instanceof Error ? error.message.slice(0, 300) : "request_failed",
    };
  }
}

export async function checkPublicSite(): Promise<SiteMonitorResult> {
  const checks = await Promise.all(
    TARGETS.map((target) => checkTarget(target.path, target.marker)),
  );
  const failed = checks.filter((check) => !check.ok);

  return {
    isHealthy: failed.length === 0,
    responseTimeMs: Math.max(...checks.map((check) => check.responseTimeMs), 0),
    checks,
    error: failed.length
      ? failed.map((check) => `${check.path}: ${check.error}`).join("; ")
      : null,
  };
}

export async function recordSiteCheck(result: SiteMonitorResult) {
  return prisma.siteHealthCheck.create({
    data: {
      siteKey: SITE_KEY,
      isHealthy: result.isHealthy,
      responseTimeMs: result.responseTimeMs,
      checks: result.checks as unknown as Prisma.InputJsonValue,
      error: result.error,
    },
  });
}

function describeChecks(checks: SiteCheckResult[]) {
  return checks
    .map(
      (check) =>
        `${check.ok ? "✓" : "✕"} ${check.path} — ${check.statusCode ?? "нет ответа"}, ${check.responseTimeMs} мс${check.error ? ` (${check.error})` : ""}`,
    )
    .join("\n");
}

export async function runSiteMonitor() {
  const previous = await prisma.siteHealthCheck.findFirst({
    where: { siteKey: SITE_KEY },
    orderBy: { createdAt: "desc" },
  });
  const result = await checkPublicSite();
  const saved = await recordSiteCheck(result);
  let notification = null;

  if (!result.isHealthy && previous?.isHealthy !== false) {
    notification = await sendSiteMail({
      subject: `⚠️ Сбой мониторинга ${SITE_BRAND}`,
      text: [
        `Мониторинг обнаружил проблему на ${getPublicBaseUrl()}.`,
        "",
        describeChecks(result.checks),
        "",
        `Время проверки: ${new Date().toLocaleString("ru-RU", { timeZone: "Asia/Almaty" })}`,
      ].join("\n"),
    });
  } else if (result.isHealthy && previous?.isHealthy === false) {
    notification = await sendSiteMail({
      subject: `✅ ${SITE_BRAND} снова работает`,
      text: [
        `Все контрольные страницы ${getPublicBaseUrl()} снова отвечают корректно.`,
        "",
        describeChecks(result.checks),
      ].join("\n"),
    });
  }

  return { result, savedId: saved.id, notification };
}

export function formatSiteChecks(checks: SiteCheckResult[]) {
  return describeChecks(checks);
}
