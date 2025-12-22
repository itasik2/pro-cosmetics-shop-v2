// prisma/seed.mjs
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
  const cleanName = (name || "").trim();
  const slug = slugify(cleanName) || "brand";

  return prisma.brand.upsert({
    where: { name: cleanName },
    update: { sortOrder },
    create: { name: cleanName, slug, sortOrder, isActive: true },
  });
}

async function main() {
  // Если хочешь, чтобы seed можно было прогонять повторно,
  // лучше проверять по конкретным таблицам и использовать upsert.
  const productsCount = await prisma.product.count();
  const postsCount = await prisma.post.count();

  if (productsCount > 0 || postsCount > 0) {
    console.log("Seed skipped: products or posts already exist.");
    return;
  }

  // 1) Данные для сидов товаров (brandName строкой — только для сидов)
  const products = [
    {
      name: "Pro Cleanser AHA 5%",
      brandName: "DERMALAB",
      description: "Мягкое кислотное очищение, pH-баланс для чувствительной кожи.",
      price: 159900,
      image: "/seed/cleanser.jpg",
      category: "Очищение",
      stock: 50,
      isPopular: true,
    },
    {
      name: "Peptide Serum 10",
      brandName: "SKN.Pro",
      description: "Пептидная сыворотка для упругости и тонуса.",
      price: 229900,
      image: "/seed/serum.jpg",
      category: "Сыворотки",
      stock: 35,
      isPopular: true,
    },
    {
      name: "Ceramide Barrier Cream",
      brandName: "NU:FORM",
      description: "Крем с церамидами для восстановления барьера.",
      price: 199900,
      image: "/seed/cream.jpg",
      category: "Кремы",
      stock: 60,
      isPopular: false,
    },
  ];

  // 2) Создаём бренды из уникальных brandName
  const uniqueBrandNames = Array.from(
    new Set(products.map((p) => (p.brandName || "").trim()).filter(Boolean))
  );

  const brandRecords = await Promise.all(
    uniqueBrandNames.map((name, i) => ensureBrand(name, i))
  );

  const brandIdByName = new Map(brandRecords.map((b) => [b.name, b.id]));

  // 3) Создаём товары с brandId
  for (const p of products) {
    const brandId = brandIdByName.get(p.brandName.trim()) || null;

    await prisma.product.create({
      data: {
        name: p.name,
        brandId,
        description: p.description,
        price: p.price,
        image: p.image,
        category: p.category,
        stock: p.stock,
        isPopular: !!p.isPopular,
      },
    });
  }

  // 4) Seed posts
  await prisma.post.createMany({
    data: [
      {
        title: "Как выбрать продукт по типу кожи",
        slug: "kak-vybrat-po-tipu-kozhi",
        content: "Короткое руководство по типам кожи и базовым активам. Без мистики.",
        category: "советы",
        image: "/seed/post1.jpg",
      },
      {
        title: "Что говорят исследования о ретиноидах",
        slug: "issledovaniya-o-retinoidah",
        content: "Сводка научных источников про ретиноиды и как не сгореть от счастья.",
        category: "исследования",
        image: "/seed/post2.jpg",
      },
    ],
  });

  console.log("Seed complete.");
}

main()
  .catch((e) => {
    console.error("Seed error:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
