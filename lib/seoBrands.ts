// lib/seoBrands.ts
import { prisma } from "@/lib/prisma";

export async function getSeoBrands() {
  return prisma.brand.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, slug: true, updatedAt: true },
  });
}

export async function getSeoBrandNames() {
  const brands = await getSeoBrands();
  return brands.map((b) => b.name);
}
