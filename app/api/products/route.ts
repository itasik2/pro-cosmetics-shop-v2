export const runtime = "nodejs";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { requireAdmin } from "@/lib/adminGuard";
import { slugify } from "@/lib/slug";
import { uniqueSlug } from "@/lib/uniqueSlug";
import { formatProductName } from "@/lib/productNames";

const ProductSchema = z.object({
  name: z.string().min(2),
  brandId: z.string().nullable().optional(),
  shortDescription: z.string().max(280).nullable().optional(),
  description: z.string().min(1),
  image: z.string().min(1),
  category: z.string().min(1),
  price: z.number().int().min(0),
  stock: z.number().int().min(0),
  isPopular: z.boolean().optional().default(false),
  isNew: z.boolean().optional().default(false),
  isPublished: z.boolean().optional().default(true),
  variants: z.any().nullable().optional(),
});

export async function GET(req: Request) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  const publicationQueue =
    new URL(req.url).searchParams.get("publicationQueue") === "1";

  const rows = await prisma.product.findMany({
    where: publicationQueue
      ? {
          isPublished: false,
          enrichmentStatus: { not: "MERGED" },
          enrichmentProposals: {
            some: { status: "APPLIED" },
          },
        }
      : { enrichmentStatus: { not: "MERGED" } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      slug: true,
      brandId: true,
      shortDescription: true,
      description: true,
      image: true,
      category: true,
      price: true,
      sourcePrice: true,
      stock: true,
      isPopular: true,
      isNew: true,
      isPublished: true,
      enrichmentStatus: true,
      supplierSku: true,
      volumeValue: true,
      volumeUnit: true,
      productLineName: true,
      createdAt: true,
      variants: true,
      brand: { select: { id: true, name: true } },
      supplier: { select: { id: true, name: true } },
      enrichmentProposals: {
        where: { status: "APPLIED" },
        orderBy: { appliedAt: "desc" },
        take: 1,
        select: {
          id: true,
          status: true,
          appliedAt: true,
        },
      },
    },
  });

  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  try {
    const parsed = ProductSchema.parse(await req.json());
    const name = formatProductName(parsed.name);

    if (parsed.brandId) {
      const brand = await prisma.brand.findUnique({
        where: { id: parsed.brandId },
        select: { id: true },
      });

      if (!brand) {
        return NextResponse.json(
          { error: "brand_not_found" },
          { status: 400 },
        );
      }
    }

    const baseSlug = slugify(name);
    const slug = await uniqueSlug({ model: "product", value: baseSlug });

    const created = await prisma.product.create({
      data: {
        name,
        slug,
        brandId: parsed.brandId ?? null,
        shortDescription: parsed.shortDescription?.trim() || null,
        description: parsed.description,
        image: parsed.image,
        category: parsed.category,
        price: parsed.price,
        stock: parsed.stock,
        isPopular: parsed.isPopular,
        isNew: parsed.isNew,
        isPublished: parsed.isPublished,
        enrichmentStatus: parsed.isPublished ? "READY" : "PENDING",
        variants: parsed.variants ?? null,
      },
      include: { brand: true, supplier: true },
    });

    return NextResponse.json(created);
  } catch (error: any) {
    if (error?.name === "ZodError") {
      return NextResponse.json(
        { error: "validation", issues: error.issues },
        { status: 400 },
      );
    }

    console.error("POST /api/products", error);
    return NextResponse.json(
      { error: "failed_to_create" },
      { status: 500 },
    );
  }
}
