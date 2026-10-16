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
