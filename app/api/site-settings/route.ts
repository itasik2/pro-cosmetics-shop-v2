// app/api/site-settings/route.ts
export const runtime = "nodejs";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const ID = "default";

export async function GET() {
  const settings = await prisma.themeSettings.findUnique({ where: { id: ID } });

  // activeNow можно считать на сервере, чтобы админка сразу показывала статус
  const activeNow = (() => {
    if (!settings) return true;
    if (!settings.scheduleEnabled) return true;

    const now = Date.now();
    const start = settings.scheduleStart ? settings.scheduleStart.getTime() : null;
    const end = settings.scheduleEnd ? settings.scheduleEnd.getTime() : null;

    if (start !== null && now < start) return false;
    if (end !== null && now > end) return false;
    return true;
  })();

  return NextResponse.json({ settings, activeNow }, { status: 200 });
}

export async function PUT(req: Request) {
  const body = (await req.json().catch(() => ({}))) as any;

  const data = {
    scheduleEnabled: !!body.scheduleEnabled,
    scheduleStart: body.scheduleStart ? new Date(body.scheduleStart) : null,
    scheduleEnd: body.scheduleEnd ? new Date(body.scheduleEnd) : null,

    backgroundUrl: String(body.backgroundUrl ?? "").trim(),

    bannerEnabled: !!body.bannerEnabled,
    bannerText: String(body.bannerText ?? "").trim(),
    bannerHref: body.bannerHref ? String(body.bannerHref).trim() : null,
  };

  const saved = await prisma.themeSettings.upsert({
    where: { id: ID },
    create: { id: ID, ...data },
    update: data,
  });

  return NextResponse.json({ settings: saved }, { status: 200 });
}
