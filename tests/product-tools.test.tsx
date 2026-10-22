import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import ProductFiltersBar from "../app/admin/(private)/products/ProductFiltersBar";
import {
  emptyProductFilters,
  productMatchesFilters,
} from "../lib/adminProductFilters";
import { productMergePlan } from "../lib/productMergePlan";
import {
  publicationMissingFields,
  publishEditedProduct,
} from "../lib/productPublication";

const product = {
  id: "main",
  name: "Крем",
  supplierSku: "SKU-50",
  supplier: { id: "supplier" },
  brandId: "brand",
  category: "  Уход за лицом  ",
  isPublished: false,
  isNew: true,
  isPopular: false,
  description: "Описание готовится",
  shortDescription: null,
  enrichmentStatus: "REVIEW",
  variants: null as unknown,
  volumeValue: 50,
  volumeUnit: "ml",
  price: 4000,
  stock: 3,
  image: "/seed/cream.jpg",
};

const publishable = {
  ...product,
  shortDescription: "Крем для ежедневного ухода",
  description: "Увлажняющий крем для лица",
  image: "/media/cream.jpg",
};

test("explicit publication from the editor accepts a complete manually reviewed imported card", () => {
  assert.deepEqual(
    publicationMissingFields(publishable, {
      imported: true,
      hasAppliedEnrichment: false,
      reviewedInEditor: true,
    }),
    [],
  );
});

test("queue publication still requires applied enrichment for imported cards", () => {
  assert.deepEqual(
    publicationMissingFields(publishable, {
      imported: true,
      hasAppliedEnrichment: false,
    }),
    ["одобрение описания и фото"],
  );
  assert.deepEqual(
    publicationMissingFields(publishable, {
      imported: true,
      hasAppliedEnrichment: true,
    }),
    [],
  );
});

test("publishing from the editor cannot skip missing content, photo, category or price", () => {
  assert.deepEqual(
    publicationMissingFields(
      { ...product, brandId: null, category: "", price: 0 },
      { imported: true, hasAppliedEnrichment: false, reviewedInEditor: true },
    ),
    [
      "бренд",
      "краткое описание",
      "описание",
      "фотография",
      "категория",
      "цена",
    ],
  );
});

test("ready manually created products do not require AI approval", () => {
  assert.deepEqual(
    publicationMissingFields(publishable, {
      imported: false,
      hasAppliedEnrichment: false,
    }),
    [],
  );
});

function publicationFixture() {
  let state = {
    product: {
      id: "main",
      name: "Крем",
      isPublished: false,
      enrichmentStatus: "REVIEW",
      updatedAt: new Date(1000),
      stock: 7,
      image: "/saved.jpg",
    },
    proposals: [
      { productId: "main", status: "PENDING" },
      { productId: "main", status: "APPLIED" },
      { productId: "other", status: "PENDING" },
    ],
    jobs: [
      { productId: "main", status: "REVIEW" },
      { productId: "other", status: "REVIEW" },
    ],
  };
  const flags = { failCleanup: false };
  const database = {
    $transaction: async (callback: (tx: any) => Promise<unknown>) => {
      const draft = structuredClone(state);
      const result = await callback({
        product: {
          updateMany: async ({ where, data }: any) => {
            if (
              where.id !== draft.product.id ||
              +where.updatedAt !== +draft.product.updatedAt ||
              where.enrichmentStatus.notIn.includes(
                draft.product.enrichmentStatus,
              )
            )
              return { count: 0 };
            Object.assign(draft.product, data, { updatedAt: new Date(2000) });
            return { count: 1 };
          },
          findUniqueOrThrow: async () => structuredClone(draft.product),
        },
        productEnrichmentProposal: {
          updateMany: async ({ where, data }: any) => {
            if (flags.failCleanup) throw new Error("database_unavailable");
            draft.proposals
              .filter(
                (row) =>
                  row.productId === where.productId &&
                  row.status === where.status,
              )
              .forEach((row) => Object.assign(row, data));
            return { count: 1 };
          },
        },
        enrichmentJob: {
          findFirst: async ({ where }: any) =>
            draft.jobs.find(
              (row) =>
                row.productId === where.productId &&
                where.status.in.includes(row.status),
            ) || null,
          updateMany: async ({ where, data }: any) => {
            draft.jobs
              .filter(
                (row) =>
                  row.productId === where.productId &&
                  row.status === where.status,
              )
              .forEach((row) => Object.assign(row, data));
            return { count: 1 };
          },
        },
      });
      state = draft;
      return result;
    },
  } as unknown as NonNullable<Parameters<typeof publishEditedProduct>[1]>;
  return {
    database,
    flags,
    get state() {
      return state;
    },
  };
}

const publicationInput = {
  productId: "main",
  expectedUpdatedAt: new Date(1000),
  data: { name: "Крем для лица" },
};

test("editor publication saves edits and closes old AI suggestions without changing inventory or other cards", async () => {
  const fixture = publicationFixture();
  const result = await publishEditedProduct(publicationInput, fixture.database);
  assert.equal(result.isPublished, true);
  assert.equal(result.name, "Крем для лица");
  assert.equal(fixture.state.product.enrichmentStatus, "READY");
  assert.equal(fixture.state.product.stock, 7);
  assert.equal(fixture.state.product.image, "/saved.jpg");
  assert.deepEqual(
    fixture.state.proposals.map((row) => row.status),
    ["REJECTED", "APPLIED", "PENDING"],
  );
  assert.deepEqual(
    fixture.state.jobs.map((row) => row.status),
    ["CANCELED", "REVIEW"],
  );
});

test("a failed AI suggestion cleanup rolls back both edits and publication", async () => {
  const fixture = publicationFixture();
  fixture.flags.failCleanup = true;
  const before = structuredClone(fixture.state);
  await assert.rejects(
    publishEditedProduct(publicationInput, fixture.database),
    /database_unavailable/,
  );
  assert.deepEqual(fixture.state, before);
});

test("active enrichment, archived cards and concurrent edits cannot be published from a stale form", async () => {
  for (const condition of ["active", "changed", "archived"] as const) {
    const fixture = publicationFixture();
    if (condition === "active") fixture.state.jobs[0].status = "RUNNING";
    if (condition === "changed")
      fixture.state.product.updatedAt = new Date(1500);
    if (condition === "archived")
      fixture.state.product.enrichmentStatus = "MERGED";
    const before = structuredClone(fixture.state);
    await assert.rejects(
      publishEditedProduct(publicationInput, fixture.database),
      condition === "active"
        ? /publication_enrichment_running/
        : /product_changed_refresh/,
    );
    assert.deepEqual(fixture.state, before);
  }
});
const filter = (patch: Partial<typeof emptyProductFilters>) => ({
  ...emptyProductFilters,
  ...patch,
});

test("publication, category, brand and supplier filters work together", () => {
  assert.ok(
    productMatchesFilters(
      product,
      filter({
        publication: "draft",
        category: "уход за лицом",
        brand: "brand",
        supplier: "supplier",
      }),
    ),
  );
  assert.equal(
    productMatchesFilters(product, filter({ publication: "published" })),
    false,
  );
  assert.equal(
    productMatchesFilters(product, filter({ brand: "other" })),
    false,
  );
  assert.equal(
    productMatchesFilters(product, filter({ supplier: "other" })),
    false,
  );
  assert.equal(
    productMatchesFilters(product, filter({ category: "волосы" })),
    false,
  );
});

test("availability filters use variants even when the product quantity is stale", () => {
  const withVariants = {
    ...product,
    stock: 900,
    variants: [{ id: "v", label: "50 мл", stock: 0 }],
  };
  assert.ok(
    productMatchesFilters(
      withVariants,
      filter({ stock: "empty", content: "variants" }),
    ),
  );
  assert.equal(
    productMatchesFilters(withVariants, filter({ stock: "available" })),
    false,
  );
  assert.ok(
    productMatchesFilters(
      {
        ...withVariants,
        stock: 0,
        variants: [{ id: "v", label: "50 мл", stock: 2 }],
      },
      filter({ stock: "available" }),
    ),
  );
});

test("incomplete cards and review flags can be found without treating fallback photos as missing", () => {
  for (const content of [
    "no-photo",
    "no-description",
    "review",
    "new",
    "no-variants",
  ] as const)
    assert.ok(productMatchesFilters(product, filter({ content })));
  const complete = {
    ...product,
    image: "/media/cream.jpg",
    shortDescription: "Крем для лица",
    description: "Увлажняющий крем",
  };
  assert.equal(
    productMatchesFilters(complete, filter({ content: "no-photo" })),
    false,
  );
  assert.equal(
    productMatchesFilters(complete, filter({ content: "no-description" })),
    false,
  );
  assert.equal(
    productMatchesFilters(complete, filter({ content: "popular" })),
    false,
  );
});

test("filter controls expose publication counts, labels and reset", () => {
  const html = renderToStaticMarkup(
    <ProductFiltersBar
      value={filter({ publication: "draft" })}
      onChange={() => {}}
      counts={{ all: 9, draft: 5, published: 4 }}
      categories={[]}
      brands={[]}
      suppliers={[]}
      priceSources={[]}
    />,
  );
  assert.match(html, /Черновики · 5/);
  assert.match(html, /Опубликованные · 4/);
  assert.match(html, /aria-pressed="true"[^>]*>Черновики/);
  for (const text of [
    "Категория товаров",
    "Бренд товаров",
    "Поставщик товаров",
    "Наличие товаров",
    "Без фото",
    "Сбросить фильтры",
  ])
    assert.ok(html.includes(text));
});

test("exact duplicate SKU keeps the larger stock and recovers its missing photo", () => {
  const plan = productMergePlan(
    [
      product,
      {
        ...product,
        id: "duplicate",
        supplierSku: "sku-50",
        stock: 7,
        image: "/media/sku-50.jpg",
      },
    ],
    product.id,
  );
  assert.equal(plan.automatic, true);
  assert.equal(plan.kind, "duplicates");
  assert.equal(plan.variants.length, 1);
  assert.equal(plan.variants[0].stock, 7);
  assert.equal(plan.variants[0].image, "/media/sku-50.jpg");
  assert.equal(
    plan.orderMappings[0].variantId,
    plan.orderMappings[1].variantId,
  );
  assert.equal(product.stock, 3);
});

test("different sizes preserve per-SKU photos and add quantities only once", () => {
  const small = { ...product, image: "/media/small.jpg" };
  const large = {
    ...product,
    id: "large",
    name: "Крем 100 мл",
    supplierSku: "SKU-100",
    volumeValue: 100,
    price: 6000,
    stock: 5,
    image: "/media/large.jpg",
  };
  const plan = productMergePlan([small, large], small.id);
  assert.equal(plan.automatic, true);
  assert.equal(plan.kind, "variants");
  assert.deepEqual(
    plan.variants.map((row) => [row.sku, row.stock, row.image]),
    [
      ["SKU-50", 3, small.image],
      ["SKU-100", 5, large.image],
    ],
  );
  assert.equal(
    plan.variants.reduce((sum, row) => sum + row.stock, 0),
    8,
  );
});

test("overlapping variant sets deduplicate by SKU and remap old order variant IDs", () => {
  const small = {
    id: "small",
    label: "50",
    sku: "SKU-50",
    price: 4000,
    stock: 2,
    image: "/small.jpg",
  };
  const large = {
    id: "large",
    label: "100",
    sku: "SKU-100",
    price: 6000,
    stock: 4,
    image: "/large.jpg",
  };
  const source = { ...product, variants: [small, large] };
  const duplicate = {
    ...product,
    id: "duplicate",
    variants: [{ ...small, id: "old-small", stock: 6 }],
  };
  const plan = productMergePlan([source, duplicate], source.id);
  assert.equal(plan.variants.length, 2);
  assert.equal(plan.variants[0].id, small.id);
  assert.equal(plan.variants[0].label, "50 мл");
  assert.equal(plan.variants[0].stock, 6);
  assert.deepEqual(
    plan.orderMappings.find(
      (row) =>
        row.productId === duplicate.id && row.fromVariantId === "old-small",
    ),
    {
      productId: duplicate.id,
      fromVariantId: "old-small",
      variantId: small.id,
    },
  );
  assert.equal(
    plan.orderMappings.find(
      (row) => row.productId === duplicate.id && row.fromVariantId === null,
    )?.variantId,
    small.id,
  );
});

test("equivalent volume units deduplicate while conflicting SKUs require correction", () => {
  const litre = { ...product, volumeValue: 1, volumeUnit: "l" };
  const millilitres = { ...product, id: "duplicate", volumeValue: 1000 };
  assert.equal(
    productMergePlan([litre, millilitres], litre.id).variants.length,
    1,
  );
  assert.throws(
    () =>
      productMergePlan(
        [product, { ...product, id: "other", supplierSku: "OTHER" }],
        product.id,
      ),
    /variant_volume_ambiguous/,
  );
  assert.throws(
    () =>
      productMergePlan(
        [product, { ...product, id: "other", volumeValue: 100 }],
        product.id,
      ),
    /sku_volume_conflict/,
  );
});

test("a merge suggests an available variant photo without assigning it to a different primary SKU", () => {
  const large = { ...product, id: "large", supplierSku: "SKU-100", volumeValue: 100, image: "/media/large.jpg" };
  const plan = productMergePlan([product, large], product.id);
  assert.equal(plan.image, large.image);
  assert.equal(plan.commonPhotoSuggestion?.sku, large.supplierSku);
  assert.equal(plan.variants.find(row => row.sku === product.supplierSku)?.image, undefined);
  assert.equal(plan.variants.find(row => row.sku === large.supplierSku)?.image, large.image);
  const existing = productMergePlan([{ ...product, image: "/media/reviewed-common.jpg" }, large], product.id);
  assert.equal(existing.image, "/media/reviewed-common.jpg");
  assert.equal(existing.commonPhotoSuggestion, null);
  const grouped = { ...product, image: plan.image, variants: plan.variants };
  const again = productMergePlan([grouped, { ...large, id: "duplicate" }], product.id);
  assert.equal(again.variants.find(row => row.sku === product.supplierSku)?.image, undefined);
  assert.equal(again.variants.find(row => row.sku === large.supplierSku)?.image, large.image);
});

test("merging existing variant cards retains each source common photo only for its primary SKU", () => {
  const small = {
    id: "small",
    label: "50 мл",
    sku: "SKU-50",
    stock: 3,
    price: 4000,
  };
  const large = {
    id: "large",
    label: "100 мл",
    sku: "SKU-100",
    stock: 5,
    price: 6000,
  };
  const extra = {
    id: "extra",
    label: "200 мл",
    sku: "SKU-200",
    stock: 1,
    price: 10000,
  };
  const plan = productMergePlan(
    [
      { ...product, image: "/photos/small.jpg", variants: [small] },
      {
        ...product,
        id: "large",
        supplierSku: "SKU-100",
        image: "/photos/large.jpg",
        variants: [large, extra],
      },
    ],
    product.id,
  );
  assert.deepEqual(
    plan.variants.map((row) => [row.sku, row.image]),
    [
      ["SKU-50", "/photos/small.jpg"],
      ["SKU-100", "/photos/large.jpg"],
      ["SKU-200", undefined],
    ],
  );
});

test("missing SKUs or conflicting duplicate prices disable automatic merge", () => {
  const missing = productMergePlan(
    [product, { ...product, id: "large", supplierSku: null, volumeValue: 100 }],
    product.id,
  );
  assert.equal(missing.automatic, false);
  assert.ok(missing.warnings.some((warning) => warning.includes("SKU")));
  const prices = productMergePlan(
    [product, { ...product, id: "duplicate", price: 9000 }],
    product.id,
  );
  assert.equal(prices.automatic, false);
  assert.equal(prices.variants[0].price, product.price);
});

test("SKU duplicates without a volume still merge, and Cyrillic volume names are recognized", () => {
  const standard = { ...product, volumeValue: null, volumeUnit: null };
  assert.equal(
    productMergePlan([standard, { ...standard, id: "duplicate" }], standard.id)
      .variants[0].label,
    "Стандартный",
  );
  assert.equal(
    productMergePlan([standard, { ...product, id: "duplicate" }], standard.id)
      .variants[0].label,
    "50 мл",
  );
  const named = { ...standard, name: "Крем 50 мл" };
  assert.equal(
    productMergePlan([named, { ...named, id: "duplicate" }], named.id)
      .variants[0].label,
    "50 мл",
  );
});
