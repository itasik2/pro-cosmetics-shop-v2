import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function slugify(input) {
  const map = {
    а:"a", б:"b", в:"v", г:"g", д:"d", е:"e", ё:"e", ж:"zh", з:"z", и:"i", й:"y",
    к:"k", л:"l", м:"m", н:"n", о:"o", п:"p", р:"r", с:"s", т:"t", у:"u", ф:"f",
    х:"h", ц:"ts", ч:"ch", ш:"sh", щ:"sch", ъ:"", ы:"y", ь:"", э:"e", ю:"yu", я:"ya",
  };

  const s = (input || "").toLowerCase().trim();

  const translit = s
    .split("")
    .map((ch) => map[ch] ?? ch)
    .join("");

  return translit
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-") || "product";
}

async function main() {
  const products = await prisma.product.findMany();

  console.log("products:", products.length);

  for (const p of products) {
    const newSlug = slugify(p.name);

    if (p.slug === newSlug) {
      console.log("skip:", p.name);
      continue;
    }

    await prisma.product.update({
      where: { id: p.id },
      data: { slug: newSlug },
    });

    console.log("updated:", p.name, "→", newSlug);
  }

  console.log("done");
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });