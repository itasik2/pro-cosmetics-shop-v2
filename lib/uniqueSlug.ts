import { prisma } from "@/lib/prisma";

type Args = {
  model: "product" | "post" | "brand";
  value: string;
};

export async function uniqueSlug({ model, value }: Args) {
  let slug = value;
  let i = 1;

  while (true) {

    let exists = null;

    if (model === "product") {
      exists = await prisma.product.findUnique({
        where: { slug },
        select: { id: true },
      });
    }

    if (model === "post") {
      exists = await prisma.post.findUnique({
        where: { slug },
        select: { id: true },
      });
    }

    if (model === "brand") {
      exists = await prisma.brand.findUnique({
        where: { slug },
        select: { id: true },
      });
    }

    if (!exists) return slug;

    slug = `${value}-${i}`;
    i++;
  }
}
