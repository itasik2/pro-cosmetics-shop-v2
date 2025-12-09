import { prisma } from "@/lib/prisma";
export const runtime = "nodejs";


export async function GET() {
  const posts = await prisma.post.findMany({ orderBy: { createdAt: "desc" } });
  return Response.json(posts);
}

export async function POST(req: Request) {
  const body = await req.json();
  const created = await prisma.post.create({ data: body });
  return Response.json(created, { status: 201 });
}
