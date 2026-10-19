import { ParsedImportRowSchema, type ParsedImportRow } from "./parsedRow";
import { baseProductName, normalizeStoredVariants } from "./productVariants";
import { normalizePriceMode } from "./pricing";
import { photoSku } from "../enrichment/variantImages";

export type PriceDecisionKind =
  | "INCREASE"
  | "UNCHANGED"
  | "DECREASE"
  | "NEW"
  | "NEW_VARIANT"
  | "REVIEW"
  | "OLDER"
  | "NO_DATE"
  | "FUTURE"
  | "APPLIED"
  | "SKIP";
export type PriceDecision = {
  kind: PriceDecisionKind;
  previousPrice: number | null;
  nextPrice: number | null;
  sourceOnly: boolean;
  message: string;
  automatic?: boolean;
  wasNew?: boolean;
};
export type PricePolicyProduct = {
  id: string;
  name: string;
  supplierSku: string | null;
  supplierId: string | null;
  brandId: string | null;
  brand?: { name: string } | null;
  price: number;
  sourcePrice: number | null;
  priceListDate: Date | null;
  stock: number;
  variants: unknown;
  updatedAt: Date;
  volumeValue: number | null;
  volumeUnit: string | null;
  image: string;
  category: string;
};
export type PricePolicyRow = {
  id: string;
  productId: string | null;
  supplierSku: string | null;
  action: string;
  confidence: number;
  selected: boolean;
  parsedData: unknown;
  rawData: unknown;
  appliedAt: Date | null;
};
export type MissingPricePosition = {
  productId: string;
  variantId: string | null;
  name: string;
  brand: string;
  sku: string;
  label: string;
  stock: number;
  price: number;
};
export type PriceReconciliation = {
  missing: MissingPricePosition[];
  newRows: number;
  decreases: number;
  automaticApplied: number;
  automaticPending: number;
  needsReview: number;
};

export function objectData(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function identity(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/giu, " ")
    .trim();
}

export function sourceDay(value: string | null | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(value + "T00:00:00.000Z");
  return Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
    ? date
    : null;
}

export function priceToday(now = new Date()) {
  return sourceDay(
    new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Asia/Almaty",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now),
  )!;
}

export function dateBlock(
  sourceDate: Date | null,
  baseline: Date | null,
  now = new Date(),
) {
  if (!sourceDate) return "NO_DATE" as const;
  // A future document is not yet an effective price list.
  if (sourceDate.getTime() > priceToday(now).getTime())
    return "FUTURE" as const;
  if (baseline && sourceDate.getTime() < baseline.getTime())
    return "OLDER" as const;
  return null;
}

export function decidePriceRow(input: {
  row: PricePolicyRow;
  products: PricePolicyProduct[];
  sourceDate: Date | null;
  baselineDate: Date | null;
  priceMode: string;
  previous?: ParsedImportRow;
  previousSourceDate?: Date | null;
  duplicateSku?: boolean;
  pricingChanged?: boolean;
}): PriceDecision {
  const sourceOnly = normalizePriceMode(input.priceMode) === "SOURCE_ONLY";
  const answer = (
    kind: PriceDecisionKind,
    message: string,
    previousPrice: number | null = null,
    nextPrice: number | null = null,
  ): PriceDecision => ({ kind, message, previousPrice, nextPrice, sourceOnly });
  if (input.row.appliedAt) {
    const saved = objectData(objectData(input.row.rawData).priceDecision);
    return {
      ...saved,
      ...answer(
        "APPLIED",
        saved.automatic
          ? "Применено автоматически"
          : "Применено администратором",
      ),
      previousPrice:
        typeof saved.previousPrice === "number" ? saved.previousPrice : null,
      nextPrice: typeof saved.nextPrice === "number" ? saved.nextPrice : null,
      automatic: saved.automatic === true,
      wasNew: saved.wasNew === true,
    };
  }
  if (input.row.action === "SKIP")
    return answer("SKIP", "Строка пропущена администратором");
  const result = ParsedImportRowSchema.safeParse(input.row.parsedData);
  if (!result.success || !result.data.supplierSku)
    return answer("REVIEW", "Проверьте распознанные данные и SKU");
  const parsed = result.data;
  const nextPrice = sourceOnly ? parsed.sourcePrice : parsed.salePrice;
  const blocked = dateBlock(input.sourceDate, input.baselineDate);
  if (blocked)
    return answer(
      blocked,
      {
        NO_DATE: "Укажите дату прайса перед применением цен",
        OLDER:
          "Существует более свежий прайс поставщика. Старые цены не применяются",
        FUTURE: "Дата прайса ещё не наступила. Цены пока не применяются",
      }[blocked],
      null,
      nextPrice,
    );
  const sku = photoSku(parsed.supplierSku);
  const matches = input.products.filter(
    (product) =>
      photoSku(product.supplierSku) === sku ||
      normalizeStoredVariants(product.variants).some(
        (variant) => photoSku(variant.sku) === sku,
      ),
  );
  if (input.duplicateSku || matches.length > 1)
    return answer(
      "REVIEW",
      "SKU неоднозначен: проверьте дубли",
      null,
      nextPrice,
    );
  const exact = matches[0];
  const product =
    exact ||
    input.products.find((product) => product.id === input.row.productId);
  if (!product)
    return {
      ...answer(
        "NEW",
        "Новая позиция: будет создан черновик с пометкой «Новинка»",
        null,
        nextPrice,
      ),
      wasNew: true,
    };
  if (input.row.productId && exact && input.row.productId !== exact.id)
    return answer(
      "REVIEW",
      "Сопоставление с карточкой требует проверки",
      null,
      nextPrice,
    );
  const variants = normalizeStoredVariants(product.variants);
  const productSourceDate =
    variants.length && input.previous
      ? (input.previousSourceDate ?? product.priceListDate)
      : product.priceListDate;
  if (dateBlock(input.sourceDate, productSourceDate) === "OLDER")
    return answer(
      "OLDER",
      "У этого товара уже применён более свежий прайс",
      null,
      nextPrice,
    );
  const matched = variants.filter((variant) => photoSku(variant.sku) === sku);
  if (!exact || (variants.length && !matched.length))
    return {
      ...answer(
        "NEW_VARIANT",
        "Новый вариант: будет добавлен с нулевым остатком и пометкой «Новинка»",
        null,
        nextPrice,
      ),
      wasNew: true,
    };
  if (matched.length > 1)
    return answer(
      "REVIEW",
      "SKU повторяется в вариантах товара",
      null,
      nextPrice,
    );
  const previousPrice = sourceOnly
    ? variants.length
      ? (input.previous?.sourcePrice ?? null)
      : product.sourcePrice
    : (matched[0]?.price ?? product.price);
  if (previousPrice !== null && nextPrice < previousPrice)
    return answer(
      "DECREASE",
      "Снижение цены — только после подтверждения администратора",
      previousPrice,
      nextPrice,
    );
  const sameBrand =
    identity(product.brand?.name || "") === identity(parsed.brand);
  const oldName = input.previous?.normalizedName || product.name;
  const sameIdentity =
    sameBrand &&
    identity(baseProductName(oldName, input.previous?.volumeLabel)) ===
      identity(baseProductName(parsed.normalizedName, parsed.volumeLabel)) &&
    (input.previous
      ? input.previous.volumeValue === parsed.volumeValue &&
        input.previous.volumeUnit === parsed.volumeUnit
      : (product.volumeValue === null ||
          product.volumeValue === parsed.volumeValue) &&
        (!product.volumeUnit || product.volumeUnit === parsed.volumeUnit)) &&
    identity(input.previous?.category || product.category) ===
      identity(parsed.category);
  if (
    !sameIdentity ||
    input.pricingChanged ||
    input.row.confidence < 75 ||
    input.row.action === "MANUAL_REVIEW" ||
    input.row.action === "ERROR" ||
    parsed.warnings.some(
      (warning) =>
        ["brand_not_found", "duplicate_sku_in_file"].includes(warning) ||
        (warning === "retail_sale_restricted" &&
          normalizePriceMode(input.priceMode) === "PRICE_AS_IS"),
    )
  )
    return answer(
      "REVIEW",
      "Изменились данные позиции или требуется проверка распознавания",
      previousPrice,
      nextPrice,
    );
  if (previousPrice === null)
    return answer(
      "REVIEW",
      "Нет подтверждённой предыдущей закупочной цены для этого SKU",
      null,
      nextPrice,
    );
  if (previousPrice === nextPrice)
    return answer("UNCHANGED", "Цена не изменилась", previousPrice, nextPrice);
  const baseline = Math.max(
    input.baselineDate?.getTime() || 0,
    productSourceDate?.getTime() || 0,
  );
  if (input.sourceDate!.getTime() <= baseline)
    return answer(
      "REVIEW",
      "Дата совпадает с текущим прайсом. Подтвердите изменение вручную",
      previousPrice,
      nextPrice,
    );
  return answer(
    "INCREASE",
    "Повышение из более свежего прайса применяется автоматически",
    previousPrice,
    nextPrice,
  );
}

export function missingPricePositions(
  products: PricePolicyProduct[],
  rows: PricePolicyRow[],
): MissingPricePosition[] {
  // Every recognized SKU counts as present, even if a row is unchecked or needs review.
  const present = new Set(
    rows
      .map((row) =>
        photoSku(row.supplierSku || objectData(row.parsedData).supplierSku),
      )
      .filter(Boolean),
  );
  return products.flatMap((product) => {
    const variants = normalizeStoredVariants(product.variants);
    const positions = variants.length
      ? variants.map((variant) => ({
          variantId: variant.id,
          sku: variant.sku || "",
          label: variant.label,
          stock: variant.stock,
          price: variant.price,
        }))
      : [
          {
            variantId: null,
            sku: product.supplierSku || "",
            label: "",
            stock: product.stock,
            price: product.price,
          },
        ];
    return positions
      .filter(
        (position) => position.sku && !present.has(photoSku(position.sku)),
      )
      .map((position) => ({
        ...position,
        productId: product.id,
        name: product.name,
        brand: product.brand?.name || "",
      }));
  });
}
