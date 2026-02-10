// app/api/site-settings/route.ts
export const runtime = "nodejs";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/adminGuard";
import { SITE_KEY } from "@/lib/siteConfig";
import { z } from "zod";

const ID = SITE_KEY;
const LEGACY_ID = "default";

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

const SiteSettingsSchema = z.object({
  scheduleEnabled: z.boolean().optional().default(false),
  scheduleStart: z.string().datetime().optional().nullable(),
  scheduleEnd: z.string().datetime().optional().nullable(),
  backgroundUrl: z.string().optional().default(""),
  bannerEnabled: z.boolean().optional().default(false),
  bannerText: z.string().optional().default(""),
  bannerHref: z.string().optional().nullable(),
});

export async function GET() {
  const settings =
    (await prisma.themeSettings.findUnique({ where: { id: ID } })) ||
    (ID === LEGACY_ID ? null : await prisma.themeSettings.findUnique({ where: { id: LEGACY_ID } }));

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
    { status: 200 },
  );
}

export async function PUT(req: Request) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  try {
    const body = SiteSettingsSchema.parse(await req.json().catch(() => ({})));

    const data = {
      scheduleEnabled: !!body.scheduleEnabled,
      scheduleStart: body.scheduleStart ? new Date(body.scheduleStart) : null,
      scheduleEnd: body.scheduleEnd ? new Date(body.scheduleEnd) : null,

      backgroundUrl: String(body.backgroundUrl ?? "").trim(),

      bannerEnabled: !!body.bannerEnabled,
      bannerText: String(body.bannerText ?? "").trim(),
      bannerHref: body.bannerHref ? String(body.bannerHref).trim() : null,
    };

    const primary = await prisma.themeSettings.findUnique({ where: { id: ID }, select: { id: true } });
    const legacy =
      ID === LEGACY_ID
        ? null
        : await prisma.themeSettings.findUnique({ where: { id: LEGACY_ID }, select: { id: true } });

    const targetId = primary?.id || legacy?.id || ID;

    const saved = await prisma.themeSettings.upsert({
      where: { id: targetId },
      create: { id: targetId, ...data },
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
      { status: 200 },
    );
  } catch (e: any) {
    if (e?.name === "ZodError") {
      return NextResponse.json({ error: "validation", issues: e.issues }, { status: 400 });
    }

    return NextResponse.json({ error: "failed_to_save" }, { status: 500 });
  }
}
