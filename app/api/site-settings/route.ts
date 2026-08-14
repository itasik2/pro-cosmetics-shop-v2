export const runtime = "nodejs";
export const revalidate = 0;

import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/adminGuard";
import { prisma } from "@/lib/prisma";
import { SITE_KEY } from "@/lib/siteConfig";
import { THEME_PROFILE_VALUES } from "@/lib/themeProfiles";

const ID = SITE_KEY;
const LEGACY_ID = "default";
const CACHE_TAG = `theme-settings:${SITE_KEY}`;

function computeActiveNow(settings: {
  scheduleEnabled: boolean;
  scheduleStart: Date | null;
  scheduleEnd: Date | null;
}) {
  if (!settings.scheduleEnabled) return true;

  const now = Date.now();
  const start = settings.scheduleStart?.getTime() ?? null;
  const end = settings.scheduleEnd?.getTime() ?? null;

  if (start !== null && now < start) return false;
  if (end !== null && now > end) return false;
  return true;
}

function isHttpUrlOrEmpty(value: string) {
  if (!value) return true;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isSafeBannerHref(value: string | null | undefined) {
  if (!value) return true;
  if (value.startsWith("/") && !value.startsWith("//")) return true;
  return isHttpUrlOrEmpty(value);
}

const SiteSettingsSchema = z
  .object({
    themeProfile: z.enum(THEME_PROFILE_VALUES).optional().default("neutral"),
    scheduleEnabled: z.boolean().optional().default(false),
    scheduleStart: z.string().datetime().optional().nullable(),
    scheduleEnd: z.string().datetime().optional().nullable(),
    backgroundUrl: z
      .string()
      .trim()
      .max(2048)
      .refine(isHttpUrlOrEmpty, "background_url_invalid")
      .optional()
      .default(""),
    bannerEnabled: z.boolean().optional().default(false),
    bannerText: z.string().trim().max(240).optional().default(""),
    bannerHref: z
      .string()
      .trim()
      .max(2048)
      .nullable()
      .optional()
      .refine(isSafeBannerHref, "banner_href_invalid"),
  })
  .superRefine((value, context) => {
    if (
      value.scheduleStart &&
      value.scheduleEnd &&
      new Date(value.scheduleStart).getTime() >
        new Date(value.scheduleEnd).getTime()
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scheduleEnd"],
        message: "schedule_end_before_start",
      });
    }
  });

export async function GET() {
  const settings =
    (await prisma.themeSettings.findUnique({ where: { id: ID } })) ||
    (ID === LEGACY_ID
      ? null
      : await prisma.themeSettings.findUnique({ where: { id: LEGACY_ID } }));

  const activeNow = settings
    ? computeActiveNow({
        scheduleEnabled: !!settings.scheduleEnabled,
        scheduleStart: settings.scheduleStart ?? null,
        scheduleEnd: settings.scheduleEnd ?? null,
      })
    : true;

  return NextResponse.json({ settings, activeNow }, { status: 200 });
}

export async function PUT(req: Request) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  try {
    const body = SiteSettingsSchema.parse(await req.json().catch(() => ({})));
    const data = {
      themeProfile: body.themeProfile,
      scheduleEnabled: body.scheduleEnabled,
      scheduleStart: body.scheduleStart ? new Date(body.scheduleStart) : null,
      scheduleEnd: body.scheduleEnd ? new Date(body.scheduleEnd) : null,
      backgroundUrl: body.backgroundUrl,
      bannerEnabled: body.bannerEnabled,
      bannerText: body.bannerText,
      bannerHref: body.bannerHref || null,
    };

    const [primary, legacy] = await Promise.all([
      prisma.themeSettings.findUnique({ where: { id: ID }, select: { id: true } }),
      ID === LEGACY_ID
        ? Promise.resolve(null)
        : prisma.themeSettings.findUnique({
            where: { id: LEGACY_ID },
            select: { id: true },
          }),
    ]);
    const targetId = primary?.id || legacy?.id || ID;

    const saved = await prisma.themeSettings.upsert({
      where: { id: targetId },
      create: { id: targetId, ...data },
      update: data,
    });

    revalidateTag(CACHE_TAG);

    return NextResponse.json(
      {
        settings: saved,
        activeNow: computeActiveNow({
          scheduleEnabled: saved.scheduleEnabled,
          scheduleStart: saved.scheduleStart,
          scheduleEnd: saved.scheduleEnd,
        }),
      },
      { status: 200 },
    );
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "validation", issues: error.issues },
        { status: 400 },
      );
    }

    return NextResponse.json({ error: "failed_to_save" }, { status: 500 });
  }
}
