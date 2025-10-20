import { prisma } from "@/lib/prisma";

export async function GET() {
  const products = await prisma.product.findMany({ orderBy: { createdAt: "desc" } });
  return Response.json(products);
}

export async function POST(req: Request) {
  const body = await req.json();
  const prod = await prisma.product.create({ data: body });
  return Response.json(prod, { status: 201 });
}
