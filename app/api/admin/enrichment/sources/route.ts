export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/adminGuard";
import { prisma } from "@/lib/prisma";
import {
  ensureDefaultSupplierSources,
  normalizedSourceDomain,
} from "@/lib/enrichment/sourcePolicies";

const SelectorsSchema = z
  .object({
    title: z.string().max(300).optional(),
    description: z.string().max(300).optional(),
    ingredients: z.string().max(300).optional(),
    application: z.string().max(300).optional(),
    images: z.string().max(300).optional(),
  })
  .optional()
  .nullable();

const SourceSchema = z.object({
  supplierId: z.string().min(1),
  name: z.string().min(2).max(120),
  domain: z.string().min(3).max(253),
  baseUrl: z.string().url().max(1000),
  sourceType: z.string().min(2).max(80).default("OFFICIAL_SITE"),
  allowSubdomains: z.boolean().default(true),
  priority: z.number().int().min(-100).max(100).default(0),
  selectors: SelectorsSchema,
});

function validateSourceUrl(input: {
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
  const hostnameAllowed =
    hostname === domain ||
    (input.allowSubdomains && hostname.endsWith(`.${domain}`));
  if (!hostnameAllowed) throw new Error("base_url_domain_mismatch");

  url.hash = "";
  return { domain, baseUrl: url.toString().replace(/\/$/, "") };
}

async function listSources() {
  const suppliers = await prisma.supplier.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, slug: true },
  });

  for (const supplier of suppliers) {
    await ensureDefaultSupplierSources({
      supplierId: supplier.id,
      supplierSlug: supplier.slug,
    });
  }

  return prisma.supplier.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    include: {
      sources: {
        orderBy: [{ priority: "desc" }, { name: "asc" }],
        include: {
          _count: { select: { productSources: true } },
        },
      },
    },
  });
}

export async function GET() {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  return NextResponse.json(await listSources());
}

export async function POST(req: Request) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  const parsed = SourceSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const supplier = await prisma.supplier.findUnique({
      where: { id: parsed.data.supplierId },
      select: { id: true },
    });
    if (!supplier) {
      return NextResponse.json(
        { error: "supplier_not_found" },
        { status: 404 },
      );
    }

    const normalized = validateSourceUrl(parsed.data);
    const source = await prisma.supplierSource.create({
      data: {
        supplierId: parsed.data.supplierId,
        name: parsed.data.name.trim(),
        domain: normalized.domain,
        baseUrl: normalized.baseUrl,
        sourceType: parsed.data.sourceType.trim().toUpperCase(),
        allowSubdomains: parsed.data.allowSubdomains,
        priority: parsed.data.priority,
        selectors: parsed.data.selectors || undefined,
        isEnabled: true,
      },
    });

    return NextResponse.json(source, { status: 201 });
  } catch (error: any) {
    const message = String(error?.message || "source_create_failed");
    const status = message.includes("Unique constraint") ? 409 : 400;
    return NextResponse.json(
      { error: "source_create_failed", message },
      { status },
    );
  }
}
