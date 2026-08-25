export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type Params = { params: { id: string } };

const INGREDIENT_HEADING = "Состав и активные компоненты";

function publicDescription(value: unknown) {
  return String(value || "")
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .filter(
      (block) =>
        !block.toLocaleLowerCase("ru-RU").startsWith(
          INGREDIENT_HEADING.toLocaleLowerCase("ru-RU"),
        ),
    )
    .join("\n\n")
    .trim();
}

export async function GET(_req: Request, { params }: Params) {
  const product = await prisma.product.findFirst({
    where: { id: params.id, isPublished: true },
    select: {
      id: true,
      name: true,
      description: true,
      price: true,
      category: true,
      brand: { select: { name: true } },
    },
  });

  if (!product) {
    return NextResponse.json({ error: "product_not_found" }, { status: 404 });
  }

  return NextResponse.json({
    ...product,
    description: publicDescription(product.description),
  });
}
