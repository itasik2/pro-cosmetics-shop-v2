import { prisma } from "@/lib/prisma";

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const prod = await prisma.product.findUnique({ where: { id: params.id } });
  if (!prod) return new Response("Not found", { status: 404 });
  return Response.json(prod);
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const body = await req.json();
  const prod = await prisma.product.update({ where: { id: params.id }, data: body });
  return Response.json(prod);
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  await prisma.product.delete({ where: { id: params.id } });
  return new Response(null, { status: 204 });
}
