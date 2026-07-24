export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/adminGuard";
import { prisma } from "@/lib/prisma";
import { normalizedSourceDomain } from "@/lib/enrichment/sourcePolicies";

type Params = { params: { id: string } };

const PatchSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  domain: z.string().min(3).max(253).optional(),
  baseUrl: z.string().url().max(1000).optional(),
  sourceType: z.string().min(2).max(80).optional(),
  isEnabled: z.boolean().optional(),
  allowSubdomains: z.boolean().optional(),
  priority: z.number().int().min(-100).max(100).optional(),
  selectors: z
    .object({
      title: z.string().max(300).optional(),
      description: z.string().max(300).optional(),
      ingredients: z.string().max(300).optional(),
      application: z.string().max(300).optional(),
      images: z.string().max(300).optional(),
    })
    .nullable()
    .optional(),
});

function normalizeAndValidate(input: {
  domain: string;
  baseUrl: string;
  allowSubdomains: boolean;
}) {
  const domain = normalizedSourceDomain(input.domain);
  if (!domain || domain.includes("/") || domain.includes(":")) {
    throw new Error("invalid_source_domain");
  }

  const url = new URL(input.baseUrl);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("invalid_source_protocol");
  }
  if (url.username || url.password) {
    throw new Error("source_credentials_not_allowed");
  }

  const hostname = normalizedSourceDomain(url.hostname);
  if (
    hostname !== domain &&
    !(input.allowSubdomains && hostname.endsWith(`.${domain}`))
  ) {
    throw new Error("base_url_domain_mismatch");
  }

  url.hash = "";
  return { domain, baseUrl: url.toString().replace(/\/$/, "") };
}

export async function PATCH(req: Request, { params }: Params) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  const parsed = PatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const existing = await prisma.supplierSource.findUnique({
    where: { id: params.id },
  });
  if (!existing) {
    return NextResponse.json({ error: "source_not_found" }, { status: 404 });
  }

  try {
    const allowSubdomains =
      parsed.data.allowSubdomains ?? existing.allowSubdomains;
    const normalized = normalizeAndValidate({
      domain: parsed.data.domain ?? existing.domain,
      baseUrl: parsed.data.baseUrl ?? existing.baseUrl,
      allowSubdomains,
    });

    const updated = await prisma.supplierSource.update({
      where: { id: existing.id },
      data: {
        ...(parsed.data.name
          ? { name: parsed.data.name.trim() }
          : {}),
        domain: normalized.domain,
        baseUrl: normalized.baseUrl,
        ...(parsed.data.sourceType
          ? { sourceType: parsed.data.sourceType.trim().toUpperCase() }
          : {}),
        ...(typeof parsed.data.isEnabled === "boolean"
          ? { isEnabled: parsed.data.isEnabled }
          : {}),
        allowSubdomains,
        ...(typeof parsed.data.priority === "number"
          ? { priority: parsed.data.priority }
          : {}),
        ...(parsed.data.selectors !== undefined
          ? { selectors: parsed.data.selectors }
          : {}),
      },
      include: {
        _count: { select: { productSources: true } },
      },
    });

    return NextResponse.json(updated);
  } catch (error: any) {
    return NextResponse.json(
      {
        error: "source_update_failed",
        message: String(error?.message || error),
      },
      { status: 400 },
    );
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  const existing = await prisma.supplierSource.findUnique({
    where: { id: params.id },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "source_not_found" }, { status: 404 });
  }

  const disabled = await prisma.supplierSource.update({
    where: { id: existing.id },
    data: { isEnabled: false },
  });

  return NextResponse.json({ source: disabled, disabled: true });
}
