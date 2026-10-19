import { NextResponse } from "next/server";
import { hubFetch, organizationId, type HubProduct } from "@/lib/hub";

export const dynamic = "force-dynamic";

type Snapshot = { items: Array<HubProduct & { stock?: number; available?: number }>; total: number };

export async function GET() {
  try {
    const snapshot = await hubFetch<Snapshot>(
      "/v1/catalog/snapshot?organizationId=" + encodeURIComponent(organizationId));
    const ready = snapshot.items.filter(product => product.sku && product.title &&
      product.categoryKey && product.price && product.price > 0 &&
      product.description?.trim() && product.images?.length);
    const payload = {
      schema: "catalog-hub/store-export", version: 1,
      organizationId, generatedAt: new Date().toISOString(),
      omittedIncomplete: snapshot.items.length - ready.length,
      products: ready.map(product => ({
        sku: product.sku, barcode: product.barcode, title: product.title,
        brand: product.brand, categoryKey: product.categoryKey,
        shortDescription: product.shortDescription, description: product.description,
        application: product.application, ingredients: product.ingredients,
        attributes: product.attributes, images: product.images,
        purchasePrice: product.purchasePrice, price: product.price,
        stock: product.stock ?? product.totals?.stock ?? 0,
        available: product.available ?? product.totals?.available ?? 0,
      })),
    };
    return new NextResponse(JSON.stringify(payload, null, 2), {
      headers: { "content-type": "application/json; charset=utf-8", "content-disposition":
        'attachment; filename="catalog-hub-store-export.json"', "cache-control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "export_failed" }, { status: 502 });
  }
}
