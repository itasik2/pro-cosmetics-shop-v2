import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function isActiveNow(s: {
  scheduleEnabled: boolean;
  scheduleStart: Date | null;
  scheduleEnd: Date | null;
}) {
  if (!s.scheduleEnabled) return true;
  const now = Date.now();
  const start = s.scheduleStart ? s.scheduleStart.getTime() : null;
  const end = s.scheduleEnd ? s.scheduleEnd.getTime() : null;

  if (start !== null && now < start) return false;
  if (end !== null && now > end) return false;
  return true;
}

function toDateOrNull(v: unknown): Date | null {
  const s = String(v || "").trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function GET() {
  // гарантируем, что запись существует
  const row = await prisma.themeSettings.upsert({
    where: { id: "default" },
    update: {},
    create: { id: "default" },
  });

  const activeNow = isActiveNow({
    scheduleEnabled: row.scheduleEnabled,
    scheduleStart: row.scheduleStart,
    scheduleEnd: row.scheduleEnd,
  });

  return NextResponse.json({
    settings: {
      ...row,
      // сериализация дат
      scheduleStart: row.scheduleStart ? row.scheduleStart.toISOString() : null,
      scheduleEnd: row.scheduleEnd ? row.scheduleEnd.toISOString() : null,
    },
    activeNow,
  });
}

export async function PUT(req: Request) {
  const body = await req.json().catch(() => ({} as any));

  const scheduleEnabled = !!body.scheduleEnabled;
  const scheduleStart = toDateOrNull(body.scheduleStart);
  const scheduleEnd = toDateOrNull(body.scheduleEnd);

  const backgroundUrl = String(body.backgroundUrl || "").trim();

  const bannerEnabled = !!body.bannerEnabled;
  const bannerText = String(body.bannerText || "").trim();
  const bannerHrefRaw = String(body.bannerHref || "").trim();
  const bannerHref = bannerHrefRaw ? bannerHrefRaw : null;

  const row = await prisma.themeSettings.upsert({
    where: { id: "default" },
    update: {
      scheduleEnabled,
      scheduleStart,
      scheduleEnd,
      backgroundUrl,
      bannerEnabled,
      bannerText,
      bannerHref,
    },
    create: {
      id: "default",
      scheduleEnabled,
      scheduleStart,
      scheduleEnd,
      backgroundUrl,
      bannerEnabled,
      bannerText,
      bannerHref,
    },
  });

  const activeNow = isActiveNow({
    scheduleEnabled: row.scheduleEnabled,
    scheduleStart: row.scheduleStart,
    scheduleEnd: row.scheduleEnd,
  });

  return NextResponse.json({
    ok: true,
    settings: {
      ...row,
      scheduleStart: row.scheduleStart ? row.scheduleStart.toISOString() : null,
      scheduleEnd: row.scheduleEnd ? row.scheduleEnd.toISOString() : null,
    },
    activeNow,
  });
}
