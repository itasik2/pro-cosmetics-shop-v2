import { prisma } from "@/lib/prisma";
import { slugify } from "@/lib/slug";

export async function uniquePostSlug(input: string, excludeId?: string) {
  const base = slugify(input);

  const exists = async (s: string) => {
    const where: any = { slug: s };
    if (excludeId) where.NOT = { id: excludeId };
    return !!(await prisma.post.findFirst({ where, select: { id: true } }));
  };

  if (!(await exists(base))) return base;

  let i = 2;
  while (await exists(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}
