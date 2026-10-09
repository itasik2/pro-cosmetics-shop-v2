import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function env(name: string, fallback = "") {
  return String(process.env[name] || fallback).trim();
}

async function main() {
  const organizationName = env("CATALOG_BOOTSTRAP_ORG_NAME", "ProCosmetics");
  const warehouseCode = env("CATALOG_BOOTSTRAP_WAREHOUSE_CODE", "PAV-01");
  const warehouseName = env("CATALOG_BOOTSTRAP_WAREHOUSE_NAME", "Павлодар");

  let organization = await prisma.organization.findFirst({
    where: { name: organizationName },
    orderBy: { createdAt: "asc" },
  });

  if (!organization) {
    organization = await prisma.organization.create({
      data: { name: organizationName },
    });
  }

  const warehouse = await prisma.warehouse.upsert({
    where: {
      organizationId_code: {
        organizationId: organization.id,
        code: warehouseCode,
      },
    },
    update: {
      name: warehouseName,
      isActive: true,
    },
    create: {
      organizationId: organization.id,
      code: warehouseCode,
      name: warehouseName,
      isActive: true,
    },
  });

  process.stdout.write(
    JSON.stringify({
      event: "catalog_hub_bootstrap",
      organization: {
        id: organization.id,
        name: organization.name,
      },
      warehouse: {
        id: warehouse.id,
        code: warehouse.code,
        name: warehouse.name,
      },
    }) + "\n",
  );
}

main()
  .catch((error) => {
    console.error("catalog_hub_bootstrap_failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
