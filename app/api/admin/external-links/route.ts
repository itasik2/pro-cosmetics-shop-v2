export const runtime = "nodejs";
export const revalidate = 0;

import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/adminGuard";
import { EXTERNAL_LINK_KINDS, normalizeExternalHttpUrl } from "@/lib/externalLinks";
import { prisma } from "@/lib/prisma";
import { SITE_KEY } from "@/lib/siteConfig";

const LinkSchema = z
  .object({
    id: z.string().trim().max(100).optional(),
    kind: z.enum(EXTERNAL_LINK_KINDS),
    label: z.string().trim().min(1).max(60),
    url: z
      .string()
      .trim()
      .max(2048)
      .refine((value) => !value || Boolean(normalizeExternalHttpUrl(value)), "url_invalid"),
    isEnabled: z.boolean(),
  })
  .superRefine((value, context) => {
    if (value.isEnabled && !value.url) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["url"],
        message: "enabled_url_required",
      });
    }
  });

const LinksSchema = z.object({
  links: z.array(LinkSchema).min(1).max(30),
});

async function readLinks() {
  return prisma.externalLink.findMany({
    where: { siteKey: SITE_KEY },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
}

export async function GET() {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  try {
    return NextResponse.json({ links: await readLinks() }, { status: 200 });
  } catch {
    return NextResponse.json({ error: "failed_to_load" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  try {
    const body = LinksSchema.parse(await req.json().catch(() => ({})));
    const data = body.links.map((link, index) => ({
      siteKey: SITE_KEY,
      kind: link.kind,
      label: link.label,
      url: link.url ? normalizeExternalHttpUrl(link.url) : "",
      isEnabled: link.isEnabled,
      sortOrder: index * 10,
    }));

    await prisma.$transaction(async (tx) => {
      await tx.externalLink.deleteMany({ where: { siteKey: SITE_KEY } });
      if (data.length > 0) {
        await tx.externalLink.createMany({ data });
      }
    });

    revalidateTag(`external-links:${SITE_KEY}`);

    return NextResponse.json({ links: await readLinks() }, { status: 200 });
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
