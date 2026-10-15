export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;
import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { requireAdmin } from "@/lib/adminGuard";
import { prisma } from "@/lib/prisma";
import { normalizeStoredVariants } from "@/lib/price-import/productVariants";
import {
  ensureDefaultSupplierSources,
  getEnabledSupplierSources,
  toAllowedPolicies,
} from "@/lib/enrichment/sourcePolicies";
import {
  priceListImagesBySku,
  priceVariantGroups,
} from "@/lib/enrichment/priceListImages";
import {
  imageGroups,
  mergeImageGroups,
  photoSku,
} from "@/lib/enrichment/variantImages";
import { searchVariantPhotos } from "@/lib/enrichment/variantPhotoSearch";
const Body = z.object({
  variantId: z.string().min(1).max(150),
  sku: z.string().min(1).max(150),
  proposalId: z.string().min(1).max(150).optional(),
});
export async function POST(
  req: Request,
  props: { params: Promise<{ id: string }> },
) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success)
    return NextResponse.json({ error: "validation" }, { status: 400 });
  const { id } = await props.params;
  try {
    const product = await prisma.product.findUnique({
      where: { id },
      include: { brand: { select: { name: true } }, supplier: true },
    });
    if (!product)
      return NextResponse.json({ error: "product_not_found" }, { status: 404 });
    const variant = normalizeStoredVariants(product.variants).find(
      (item) => item.id === body.data.variantId,
    );
    if (!variant || photoSku(variant.sku) !== photoSku(body.data.sku))
      return NextResponse.json(
        {
          error: "variant_sku_changed",
          message:
            "Сохраните изменения SKU и обновите карточку перед поиском фото.",
        },
        { status: 409 },
      );
    if (!product.supplier)
      return NextResponse.json(
        {
          error: "product_supplier_required",
          message: "Укажите поставщика товара для поиска фото.",
        },
        { status: 422 },
      );
    let proposalUrl: string | null = null;
    if (body.data.proposalId) {
      const proposal = await prisma.productEnrichmentProposal.findFirst({
        where: { id: body.data.proposalId, productId: id, status: "PENDING" },
        select: { id: true, sourceUrl: true },
      });
      if (!proposal)
        return NextResponse.json(
          { error: "proposal_not_pending" },
          { status: 409 },
        );
      proposalUrl = proposal.sourceUrl;
    }
    await ensureDefaultSupplierSources({
      supplierId: product.supplier.id,
      supplierSlug: product.supplier.slug,
      supplierName: product.supplier.name,
      brandName: product.brand?.name,
    });
    const sources = await getEnabledSupplierSources(product.supplier.id);
    const prices = await priceListImagesBySku([id]);
    const priceGroup = priceVariantGroups(id, [variant], prices)[0];
    const result = await searchVariantPhotos({
      product,
      variant,
      knownUrl: product.sourceUrl,
      knownUrls: proposalUrl ? [proposalUrl] : [],
      officialDomains: sources
        .filter((source) => source.sourceType === "OFFICIAL_SITE")
        .map((source) => source.domain),
      policies: toAllowedPolicies(sources),
      priceCandidates: priceGroup?.candidates || [],
    });
    let group = {
      variantId: variant.id,
      sku: variant.sku!,
      candidates: result.candidates,
    };
    if (result.status === "INCOMPLETE")
      console.warn("variant_photo_search_incomplete", {
        productId: id,
        variantId: variant.id,
        sku: variant.sku,
        issues: result.issues.map((issue) => issue.code),
      });
    // An unsuccessful retry must not erase previously reviewed candidates.
    if (body.data.proposalId && result.candidates.length)
      await prisma.$transaction(async (tx) => {
        const current = await tx.product.findUniqueOrThrow({
          where: { id },
          select: { variants: true },
        });
        const fresh = normalizeStoredVariants(current.variants).find(
          (item) => item.id === variant.id,
        );
        if (!fresh || photoSku(fresh.sku) !== photoSku(group.sku))
          throw new Error("variant_sku_changed");
        const proposal = await tx.productEnrichmentProposal.findUniqueOrThrow({
          where: { id: body.data.proposalId },
        });
        if (proposal.productId !== id || proposal.status !== "PENDING")
          throw new Error("proposal_not_pending");
        const facts =
          proposal.facts &&
          typeof proposal.facts === "object" &&
          !Array.isArray(proposal.facts)
            ? (proposal.facts as Record<string, unknown>)
            : {};
        const other = imageGroups(facts.variantImageCandidates).filter(
          (item) => item.variantId !== variant.id,
        );
        const previous = imageGroups(facts.variantImageCandidates).filter(
          (item) =>
            item.variantId === variant.id &&
            photoSku(item.sku) === photoSku(group.sku),
        );
        group = mergeImageGroups([group], previous)[0];
        const written = await tx.productEnrichmentProposal.updateMany({
          where: {
            id: proposal.id,
            status: "PENDING",
            updatedAt: proposal.updatedAt,
          },
          data: {
            facts: {
              ...facts,
              variantImageCandidates: mergeImageGroups(other, [group]),
            } as unknown as Prisma.InputJsonValue,
          },
        });
        if (written.count !== 1) throw new Error("proposal_changed_refresh");
      });
    return NextResponse.json({
      ...result,
      candidates: group.candidates,
      variantId: variant.id,
      group,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "variant_image_search_failed";
    return NextResponse.json(
      { error: message },
      { status: /changed|not_pending/.test(message) ? 409 : 500 },
    );
  }
}
