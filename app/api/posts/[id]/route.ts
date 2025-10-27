import { prisma } from "@/lib/prisma";

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const body = await req.json();
  const updated = await prisma.post.update({ where: { id: params.id }, data: body });
  return Response.json(updated);
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  await prisma.post.delete({ where: { id: params.id } });
  return new Response(null, { status: 204 });
}
