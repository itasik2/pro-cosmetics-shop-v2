// app/api/site-settings/route.ts
export const runtime = "nodejs";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const ID = "default";

function computeActiveNow(s: {
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

export async function GET() {
  const settings = await prisma.themeSettings.findUnique({ where: { id: ID } });

  const activeNow = settings
    ? computeActiveNow({
        scheduleEnabled: !!settings.scheduleEnabled,
        scheduleStart: settings.scheduleStart ?? null,
        scheduleEnd: settings.scheduleEnd ?? null,
      })
    : true;

  return NextResponse.json(
    {
      settings,
      activeNow,
    },
    { status: 200 }
  );
}

export async function PUT(req: Request) {
  const body = (await req.json().catch(() => ({}))) as any;

  // приведение типов + безопасные строки
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

  const activeNow = computeActiveNow({
    scheduleEnabled: !!saved.scheduleEnabled,
    scheduleStart: saved.scheduleStart ?? null,
    scheduleEnd: saved.scheduleEnd ?? null,
  });

  return NextResponse.json(
    {
      settings: saved,
      activeNow,
    },
    { status: 200 }
  );
}