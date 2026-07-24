import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  let body: { ids?: string[] } = {};
  try {
    body = (await req.json()) as { ids?: string[] };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const ids = Array.isArray(body.ids) ? body.ids.filter(Boolean) : [];
  if (ids.length === 0) return NextResponse.json({ products: [] });

  const uniqueIds = Array.from(new Set(ids)).slice(0, 100);

  const rows = await prisma.product.findMany({
    where: {
      id: { in: uniqueIds },
      isPublished: true,
    },
    select: {
      id: true,
      slug: true,
      name: true,
      image: true,
      price: true,
      stock: true,
      category: true,
      variants: true,
      brand: { select: { name: true } },
    },
  });

  const map = new Map(rows.map((product) => [product.id, product]));
  const ordered = uniqueIds
    .map((id) => map.get(id))
    .filter((product): product is NonNullable<typeof product> => Boolean(product));

  return NextResponse.json({ products: ordered });
}
