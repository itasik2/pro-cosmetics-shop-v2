import { prisma } from "@/lib/prisma";
import PriceImportMaintenance from "./PriceImportMaintenance";
import PriceImportsClient from "./PriceImportsClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function Page() {
  const [suppliers, brands] = await Promise.all([
    prisma.supplier.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, slug: true, siteUrl: true },
    }),
    prisma.brand.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, slug: true },
    }),
  ]);

  return (
    <div className="space-y-6">
      <PriceImportsClient initialSuppliers={suppliers} initialBrands={brands} />
      <PriceImportMaintenance />
    </div>
  );
}
