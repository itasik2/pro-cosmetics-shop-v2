import { PriceImportStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type PriceImportDateComparison = {
  status: "NO_BASELINE" | "NO_SOURCE_DATE" | "CURRENT" | "OLDER";
  sourceDate: Date | null;
  currentSourceDate: Date | null;
  currentImportId: string | null;
  currentFileName: string | null;
};

export async function comparePriceImportDate(input: {
  supplierId: string;
  sourceDate: Date | null;
  excludeImportId?: string | null;
}): Promise<PriceImportDateComparison> {
  const current = await prisma.priceImport.findFirst({
    where: {
      supplierId: input.supplierId,
      status: PriceImportStatus.APPLIED,
      sourceDate: { not: null },
      ...(input.excludeImportId ? { id: { not: input.excludeImportId } } : {}),
    },
    select: {
      id: true,
      fileName: true,
      sourceDate: true,
    },
    orderBy: [{ sourceDate: "desc" }, { appliedAt: "desc" }],
  });

  if (!current?.sourceDate) {
    return {
      status: input.sourceDate ? "NO_BASELINE" : "NO_SOURCE_DATE",
      sourceDate: input.sourceDate,
      currentSourceDate: null,
      currentImportId: null,
      currentFileName: null,
    };
  }

  if (!input.sourceDate) {
    return {
      status: "NO_SOURCE_DATE",
      sourceDate: null,
      currentSourceDate: current.sourceDate,
      currentImportId: current.id,
      currentFileName: current.fileName,
    };
  }

  return {
    status:
      input.sourceDate.getTime() < current.sourceDate.getTime()
        ? "OLDER"
        : "CURRENT",
    sourceDate: input.sourceDate,
    currentSourceDate: current.sourceDate,
    currentImportId: current.id,
    currentFileName: current.fileName,
  };
}

export async function compareStoredPriceImportDate(importId: string) {
  const priceImport = await prisma.priceImport.findUnique({
    where: { id: importId },
    select: { id: true, supplierId: true, sourceDate: true },
  });

  if (!priceImport) return null;

  return comparePriceImportDate({
    supplierId: priceImport.supplierId,
    sourceDate: priceImport.sourceDate,
    excludeImportId: priceImport.id,
  });
}
