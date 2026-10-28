import { createCatalogPost } from "@/lib/catalogApi";
import { loadCatalogProducts } from "@/lib/publicCatalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = createCatalogPost(loadCatalogProducts);
