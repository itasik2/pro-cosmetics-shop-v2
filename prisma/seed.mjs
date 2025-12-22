import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

function slugify(input) {
  return input
    .toLowerCase()
    .trim()
    .replace(/[_\s]+/g, "-")
    .replace(/[^a-z0-9а-яё-]+/gi, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

async function ensureBrand(name, sortOrder = 0) {
  const slug = slugify(name) || "brand";
  return prisma.brand.upsert({
    where: { name },
    update: { sortOrder },
    create: { name, slug, sortOrder, isActive: true },
  });
}


async function main() {
  const count = await prisma.product.count();
  if (count > 0) {
    console.log("Seed skipped, products already exist.");
    return;
  }
  await prisma.product.createMany({
    data: [
      {
        name: "Pro Cleanser AHA 5%",
        brand: "DERMALAB",
        description: "Мягкое кислотное очищение, pH-баланс для чувствительной кожи.",
        price: 159900,
        image: "/seed/cleanser.jpg",
        category: "Очищение",
        stock: 50
      },
      {
        name: "Peptide Serum 10",
        brand: "SKN.Pro",
        description: "Пептидная сыворотка для упругости и тонуса.",
        price: 229900,
        image: "/seed/serum.jpg",
        category: "Сыворотки",
        stock: 35
      },
      {
        name: "Ceramide Barrier Cream",
        brand: "NU:FORM",
        description: "Крем с церамидами для восстановления барьера.",
        price: 199900,
        image: "/seed/cream.jpg",
        category: "Кремы",
        stock: 60
      }
    ]
  });
  console.log("Seed complete.");
}

main().finally(async () => await prisma.$disconnect());


// Seed posts
await prisma.post.createMany({
  data: [
    {
      title: "Как выбрать продукт по типу кожи",
      slug: "kak-vybrat-po-tipu-kozhi",
      content: "Короткое руководство по типам кожи и базовым активам. Без мистики.",
      category: "советы",
      image: "/seed/post1.jpg"
    },
    {
      title: "Что говорят исследования о ретиноидах",
      slug: "issledovaniya-o-retinoidah",
      content: "Сводка научных источников про ретиноиды и как не сгореть от счастья.",
      category: "исследования",
      image: "/seed/post2.jpg"
    }
  ]
});
