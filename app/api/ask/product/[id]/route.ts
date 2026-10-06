import { prisma } from "@/lib/prisma";
import { publicProductCategory } from "@/lib/catalogFilters";
import { recommendationFromProduct } from "@/lib/consultantCatalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const product = await prisma.product.findFirst({
    where: { id, isPublished: true, enrichmentStatus: { not: "MERGED" } },
    select: { id: true, slug: true, name: true, image: true, description: true, shortDescription: true,
      category: true, productLineName: true, price: true, stock: true, variants: true, brand: { select: { name: true } } },
  });
  if (!product) return Response.json({ error: "product_not_found" }, { status: 404 });
  const card = recommendationFromProduct(product, { care: "", category: "", maxPrice: null, brand: "", query: "" }, "");
  return Response.json({ id: product.id, slug: product.slug, name: product.name, brand: product.brand,
    category: publicProductCategory(product), price: card?.price ?? null, volume: card?.volume ?? "", inStock: !!card }, { headers: { "Cache-Control": "no-store" } });
}
