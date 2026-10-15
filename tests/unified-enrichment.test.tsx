import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { VariantPhotosReview } from "../components/VariantPhotoPicker";
import {
  automaticPhotoPlan,
  mergeAutomaticSelections,
} from "../lib/enrichment/automaticPhotos";
import { collectProposalPhotos } from "../lib/enrichment/prepareProposalPhotos";
import { removeProposalVariant } from "../lib/enrichment/removeProposalVariant";
import { applyProductEnrichmentProposalUniversal } from "../lib/enrichment/applyProposalUniversal";
import {
  removedVariantSkus,
  shouldSkipRemovedVariant,
} from "../lib/enrichment/removedVariants";
import { extractProductFromHtml } from "../lib/enrichment/extractProduct";
import { searchVariantPhotos } from "../lib/enrichment/variantPhotoSearch";
import { sanitizeProposalTitle } from "../lib/enrichment/proposalText";
import { evaluateCatalogAutopilotProposal } from "../lib/enrichment/catalogAutopilotPolicy";
import type { VariantImageGroup } from "../lib/enrichment/variantImages";

const variants = [
  { id: "small", label: "7", sku: "MV16", price: 1500, stock: 3 },
  { id: "large", label: "50", sku: "AG16", price: 7000, stock: 2 },
];
const product = {
  id: "p",
  name: "Маска для кожи вокруг глаз",
  image: "/seed/cream.jpg",
  variants,
  supplierSku: "MV16",
  barcode: null,
  volumeValue: 7,
  volumeUnit: "ml",
  brand: { name: "ANGIOPHARM" },
  supplier: { name: "ANGIOPHARM" },
};
const groups: VariantImageGroup[] = variants.map((variant) => ({
  variantId: variant.id,
  sku: variant.sku,
  candidates: [
    { url: `https://brand.example/${variant.sku}.jpg`, source: "WEB" },
  ],
}));

test("automatic photos select exact SKU images, prefer the site, and never use an unverified common gallery", () => {
  const facts = {
    variantImageCandidates: [
      {
        ...groups[0],
        candidates: [
          { url: "https://cdn.example/price.jpg", source: "PRICE_LIST" },
          ...groups[0].candidates,
        ],
      },
      groups[1],
      {
        variantId: "large",
        sku: "OTHER",
        candidates: [{ url: "https://cdn.example/wrong.jpg", source: "WEB" }],
      },
    ],
    images: [
      "https://shop.example/logo.png",
      "https://shop.example/other-brand.jpg",
    ],
  };
  const plan = automaticPhotoPlan(product, facts);
  assert.equal(plan.imageUrl, "https://brand.example/MV16.jpg");
  assert.deepEqual(
    plan.variantImages.map((item) => [item.sku, item.imageUrl]),
    [
      ["MV16", "https://brand.example/MV16.jpg"],
      ["AG16", "https://brand.example/AG16.jpg"],
    ],
  );
  const noMatch = automaticPhotoPlan(product, { images: facts.images });
  assert.equal(noMatch.imageUrl, null);
  assert.deepEqual(noMatch.variantImages, []);
  const existing = automaticPhotoPlan(
    {
      ...product,
      image: "/common.jpg",
      variants: variants.map((variant) => ({
        ...variant,
        image: "/saved.jpg",
      })),
    },
    facts,
  );
  assert.equal(existing.imageUrl, null);
  assert.deepEqual(existing.variantImages, []);
});

test("automatic choices preserve an explicit common fallback and discard removed or changed SKUs", () => {
  const automatic = automaticPhotoPlan(product, {
    variantImageCandidates: groups,
  }).variantImages;
  const result = mergeAutomaticSelections(
    automatic,
    [{ variantId: "large", sku: "AG16", imageUrl: null }],
    variants,
  );
  assert.equal(
    result.find((item) => item.variantId === "large")?.imageUrl,
    null,
  );
  assert.deepEqual(
    mergeAutomaticSelections(automatic, [], [{ ...variants[1], sku: "NEW" }]),
    [],
  );
});

test("automatic collection searches missing variants with bounded concurrency and keeps price candidates", async () => {
  let running = 0,
    peak = 0;
  const lookedUp: string[] = [];
  const price: VariantImageGroup = {
    variantId: "large",
    sku: "AG16",
    candidates: [
      { url: "https://price.example/AG16.jpg", source: "PRICE_LIST" },
    ],
  };
  const photos = await collectProposalPhotos(
    {
      product,
      groups: [price],
      knownUrl: "https://brand.example/mask",
      officialDomains: ["brand.example"],
      policies: [],
      deadlineAt: Date.now() + 5000,
    },
    async (input) => {
      running++;
      peak = Math.max(peak, running);
      lookedUp.push(input.variant.sku!);
      assert.equal(input.catalogOnly, true);
      await Promise.resolve();
      running--;
      return {
        sku: input.variant.sku!,
        status: "FOUND",
        issues: [],
        candidates:
          input.variant.sku === "MV16"
            ? groups[0].candidates
            : input.priceCandidates,
      };
    },
  );
  assert.deepEqual(lookedUp.sort(), ["AG16", "MV16"]);
  assert.ok(peak <= 2);
  const plan = automaticPhotoPlan(product, photos);
  assert.equal(
    plan.variantImages.find((item) => item.sku === "AG16")?.imageUrl,
    price.candidates[0].url,
  );
  const kept = await collectProposalPhotos(
    {
      product,
      groups: [price],
      knownUrl: "",
      officialDomains: [],
      policies: [],
      deadlineAt: Date.now() - 1,
    },
    async () => {
      throw new Error("must not run");
    },
  );
  assert.equal(kept.photoAutomation.incomplete, true);
  assert.equal(
    kept.variantImageCandidates[0].candidates[0].url,
    price.candidates[0].url,
  );
});

test("automatic catalog lookup never triggers an AI request when a SKU is absent", async () => {
  const result = await searchVariantPhotos(
    {
      product,
      variant: variants[1],
      officialDomains: ["angiopharm.com"],
      policies: [],
      priceCandidates: [],
      catalogOnly: true,
    },
    {
      official: async () => {
        throw new Error("AI must not run");
      },
      external: async () => {
        throw new Error("AI must not run");
      },
      fetchHtml: async (url) => ({
        buffer: Buffer.from('<main id="content"><p>Не найдено</p></main>'),
        finalUrl: url,
        contentType: "text/html",
        status: 200,
        headers: {},
      }),
    },
  );
  assert.equal(result.status, "NOT_FOUND");
  assert.deepEqual(result.candidates, []);
});

test("product photos in an icons directory survive while logos, stubs and recommendations are excluded", () => {
  const extracted = extractProductFromHtml({
    finalUrl: "https://cosmogid.ru/store/mask",
    buffer: Buffer.from(`
    <meta property="og:image" content="/uploadedFiles/eshopimages/icons/350x350/mask.png">
    <main><h1>Маска</h1><picture><img src="/img/stub.png"></picture>
    <div class="recommendations"><img src="/unrelated-academie.jpg"></div>
    <div class="product-gallery"><img src="/logo.png"><img src="/photo-back.jpg"></div></main>`),
  });
  assert.deepEqual(extracted.images, [
    "https://cosmogid.ru/uploadedFiles/eshopimages/icons/350x350/mask.png",
    "https://cosmogid.ru/photo-back.jpg",
  ]);
  assert.equal(
    sanitizeProposalTitle(
      "ANGIOPHARM - Крем MAX, 50 мл - Студия красоты 9 Ангелов",
    ),
    "ANGIOPHARM - Крем MAX, 50 мл",
  );
});

test("the official Cloud Zoom gallery supplies original photos without collecting recommendations", () => {
  const extracted = extractProductFromHtml({
    finalUrl: "https://angiopharm.com/510-tonik",
    buffer: Buffer.from(`
    <main id="content"><div class="product-zoom-image"><a class="cloud-zoom main-image" id="product-cloud-zoom" href="/image/catalog/products/AG01_1.jpg"><img src="/thumb.jpg"></a></div>
    <div class="additional-images"><a class="cloud-zoom-gallery sub-image" href="/image/catalog/products/AG01.jpg"><img src="/thumb2.jpg"></a></div>
    <div class="product-layout"><img src="/unrelated.jpg"></div></main>`),
  });
  assert.ok(
    extracted.images.includes(
      "https://angiopharm.com/image/catalog/products/AG01_1.jpg",
    ),
  );
  assert.ok(
    extracted.images.includes(
      "https://angiopharm.com/image/catalog/products/AG01.jpg",
    ),
  );
  assert.ok(!extracted.images.includes("https://angiopharm.com/unrelated.jpg"));
});

function deletionFixture() {
  let state: any = {
    product: {
      ...product,
      price: 1500,
      stock: 5,
      supplierId: "supplier",
      isPublished: false,
      sourceUrl: "https://brand.example/small",
      updatedAt: new Date(1000),
    },
    proposals: [
      {
        id: "proposal",
        productId: "p",
        status: "PENDING",
        confidence: 26,
        shortDescription: "Омолаживающая маска для кожи вокруг глаз.",
        description: "Маска для ухода за кожей вокруг глаз.",
        sourceUrl: "https://brand.example/small",
        jobId: "job",
        images: groups.flatMap((group) =>
          group.candidates.map((candidate) => candidate.url),
        ),
        updatedAt: new Date(1000),
        facts: { variantImageCandidates: groups, keep: "text" },
      },
    ],
  };
  const flags = { failProduct: false, failProposal: false };
  let clock = 2000;
  function db(get: () => any): any {
    return {
      product: {
        findUnique: async () => structuredClone(get().product),
        findUniqueOrThrow: async () => structuredClone(get().product),
        update: async ({ data }: any) =>
          Object.assign(get().product, structuredClone(data)),
        updateMany: async ({ where, data }: any) => {
          if (
            flags.failProduct ||
            +where.updatedAt !== +get().product.updatedAt
          )
            return { count: 0 };
          Object.assign(get().product, structuredClone(data), {
            updatedAt: new Date(clock++),
          });
          return { count: 1 };
        },
      },
      productEnrichmentProposal: {
        findUnique: async ({ where }: any) =>
          get().proposals.some((row: any) => row.id === where.id)
            ? structuredClone({
                ...get().proposals.find((row: any) => row.id === where.id),
                product: get().product,
              })
            : null,
        count: async () =>
          get().proposals.filter((row: any) => row.status === "PENDING").length,
        findMany: async () =>
          structuredClone(
            get().proposals.filter((row: any) => row.status === "PENDING"),
          ),
        updateMany: async ({ where, data }: any) => {
          const row = get().proposals.find((row: any) => row.id === where.id);
          if (
            !row ||
            flags.failProposal ||
            row.status !== where.status ||
            +row.updatedAt !== +where.updatedAt
          )
            return { count: 0 };
          Object.assign(row, structuredClone(data), {
            updatedAt: new Date(clock++),
          });
          return { count: 1 };
        },
      },
      productImage: {
        updateMany: async () => ({ count: 1 }),
        update: async () => ({}),
      },
      enrichmentJob: { update: async () => ({}) },
      $transaction: async (callback: (tx: any) => Promise<any>) => {
        const draft = structuredClone(state);
        const result = await callback(db(() => draft));
        state = draft;
        return result;
      },
    };
  }
  return {
    database: db(() => state),
    flags,
    get state() {
      return state;
    },
  };
}
const remove = {
  productId: "p",
  proposalId: "proposal",
  variantId: "small",
  sku: "MV16",
};

test("deleting the primary variant then applying the remaining SKU photo and stock succeeds", async () => {
  const f = deletionFixture();
  await removeProposalVariant(remove, f.database);
  const proposal = f.state.proposals[0];
  assert.deepEqual(proposal.images, []);
  const plan = automaticPhotoPlan(f.state.product, proposal.facts);
  assert.equal(plan.imageUrl, "https://brand.example/AG16.jpg");
  const uploads: string[] = [];
  await applyProductEnrichmentProposalUniversal(
    {
      proposalId: proposal.id,
      mode: "ALL",
      imageUrl: plan.imageUrl,
      variantImages: plan.variantImages,
      variantStocks: { large: 3 },
    },
    {
      database: f.database,
      loadPriceImages: async () => new Map(),
      loadCommonPriceImage: async () => null,
      importImage: async (input) => {
        uploads.push(input.sourceUrl);
        return {
          id: "ag16-media",
          url: "https://media.example/AG16.jpg",
        } as any;
      },
    },
  );
  assert.equal(f.state.proposals[0].status, "APPLIED");
  assert.equal(f.state.product.image, "https://media.example/AG16.jpg");
  assert.equal(f.state.product.variants.length, 1);
  assert.equal(f.state.product.variants[0].sku, "AG16");
  assert.equal(f.state.product.variants[0].image, f.state.product.image);
  assert.equal(f.state.product.variants[0].stock, 3);
  assert.equal(f.state.product.stock, 3);
  assert.equal(f.state.product.price, 7000);
  assert.equal(f.state.product.isPublished, false);
  assert.deepEqual(uploads, ["https://brand.example/AG16.jpg"]);
  assert.deepEqual(removedVariantSkus(f.state.proposals[0].facts), ["MV16"]);
});

test("a photo belonging to another SKU or a removed variant cannot become the common photo", async () => {
  for (const target of ["sibling", "removed", "foreign-product"]) {
    const f = deletionFixture();
    const proposal = f.state.proposals[0];
    proposal.images = [];
    let imageUrl = "https://brand.example/AG16.jpg";
    if (target === "removed") {
      proposal.facts.variantImageCandidates = [
        { ...groups[0], variantId: "deleted-id" },
      ];
      imageUrl = groups[0].candidates[0].url;
    }
    if (target === "foreign-product") {
      proposal.facts.variantImageCandidates = [];
      proposal.facts.productImageCandidates = [
        { ...groups[0], variantId: "product:someone-else" },
      ];
      imageUrl = groups[0].candidates[0].url;
    }
    const before = structuredClone(f.state);
    let uploads = 0;
    await assert.rejects(
      applyProductEnrichmentProposalUniversal(
        { proposalId: "proposal", mode: "ALL", imageUrl },
        {
          database: f.database,
          loadCommonPriceImage: async () => null,
          importImage: async () => {
            uploads++;
            throw new Error("must not upload");
          },
        },
      ),
      /proposal_image_not_allowed/,
    );
    assert.equal(uploads, 0);
    assert.deepEqual(f.state, before);
    if (target !== "sibling")
      assert.equal(
        automaticPhotoPlan(f.state.product, proposal.facts).imageUrl,
        null,
      );
  }
});

test("a confirmed primary product photo is accepted without a legacy image gallery", async () => {
  const f = deletionFixture();
  f.state.product.variants = [];
  f.state.proposals[0].images = [];
  f.state.proposals[0].facts = {
    productImageCandidates: [{ ...groups[0], variantId: "product:p" }],
  };
  const plan = automaticPhotoPlan(f.state.product, f.state.proposals[0].facts);
  await applyProductEnrichmentProposalUniversal(
    { proposalId: "proposal", mode: "ALL", imageUrl: plan.imageUrl, stock: 3 },
    {
      database: f.database,
      importImage: async () =>
        ({ id: "media", url: "https://media.example/MV16.jpg" }) as any,
      loadCommonPriceImage: async () => {
        throw new Error("confirmed SKU photo must not need a price row");
      },
    },
  );
  assert.equal(f.state.product.image, "https://media.example/MV16.jpg");
  assert.equal(f.state.product.stock, 3);
  assert.equal(f.state.proposals[0].status, "APPLIED");
});

test("a primary SKU changed during upload cannot receive the old SKU photo even during manual application", async () => {
  const f = deletionFixture();
  await removeProposalVariant(remove, f.database);
  const plan = automaticPhotoPlan(f.state.product, f.state.proposals[0].facts);
  await assert.rejects(
    applyProductEnrichmentProposalUniversal(
      { proposalId: "proposal", mode: "ALL", imageUrl: plan.imageUrl },
      {
        database: f.database,
        loadCommonPriceImage: async () => null,
        importImage: async () => {
          f.state.product.supplierSku = "AG17";
          f.state.product.variants[0].sku = "AG17";
          f.state.product.updatedAt = new Date(5000);
          return { id: "media", url: "https://media.example/AG16.jpg" } as any;
        },
      },
    ),
    /variant_sku_changed/,
  );
  assert.equal(f.state.product.supplierSku, "AG17");
  assert.equal(f.state.product.variants[0].image, undefined);
  assert.equal(f.state.product.image, "/seed/cream.jpg");
  assert.equal(f.state.product.stock, 2);
  assert.equal(f.state.proposals[0].status, "PENDING");
});

test("deletion updates SKU, minimum price and total stock, preserves history, and removes photo choices only for that variant", async () => {
  const f = deletionFixture();
  await removeProposalVariant(remove, f.database);
  assert.deepEqual(f.state.product.variants, [variants[1]]);
  assert.equal(f.state.product.stock, 2);
  assert.equal(f.state.product.price, 7000);
  assert.equal(f.state.product.supplierSku, "AG16");
  assert.equal(f.state.product.volumeValue, 50);
  assert.equal(f.state.product.sourceUrl, null);
  const facts = f.state.proposals[0].facts;
  assert.deepEqual(facts.variantImageCandidates, [groups[1]]);
  assert.deepEqual(removedVariantSkus(facts), ["MV16"]);
  assert.equal(facts.removedVariants[0].sku, "MV16");
  assert.equal(facts.keep, "text");
  assert.equal(facts.manualVariantReviewRequired, true);
});

test("wrong SKU, wrong proposal, last variant and competing writes cannot partially delete a variant", async () => {
  for (const scenario of [
    "sku",
    "proposal",
    "last",
    "product-race",
    "proposal-race",
  ]) {
    const f = deletionFixture();
    if (scenario === "last") f.state.product.variants = [variants[0]];
    if (scenario === "product-race") f.flags.failProduct = true;
    if (scenario === "proposal-race") f.flags.failProposal = true;
    const before = structuredClone(f.state);
    await assert.rejects(
      removeProposalVariant(
        {
          ...remove,
          ...(scenario === "sku" ? { sku: "OTHER" } : {}),
          ...(scenario === "proposal" ? { proposalId: "wrong" } : {}),
        },
        f.database,
      ),
    );
    assert.deepEqual(f.state, before);
  }
});

test("future imports skip deleted SKUs while an explicit restoration wins over history", () => {
  const excluded = new Set(
    removedVariantSkus({ removedVariantSkus: [" mv16 ", "AV-02"] }),
  );
  assert.equal(
    shouldSkipRemovedVariant("MV16", excluded, new Set(["AG16"])),
    true,
  );
  assert.equal(shouldSkipRemovedVariant("AV02", excluded, new Set()), false);
  assert.equal(
    shouldSkipRemovedVariant("MV16", excluded, new Set(["MV16"])),
    false,
  );
  const evaluation = evaluateCatalogAutopilotProposal(
    { confidence: 99, manualVariantEdited: true },
    { enabled: true, minConfidence: 90 },
  );
  assert.equal(evaluation.decision, "REVIEW");
  assert.deepEqual(evaluation.reasons, ["manual_variant_review_required"]);
});

test("variant stock and deletion controls are rendered alongside each exact SKU and the common fallback", () => {
  const html = renderToStaticMarkup(
    <VariantPhotosReview
      product={product}
      proposalId="proposal"
      facts={{}}
      value={[]}
      onChange={() => {}}
      onRemove={() => {}}
      onStockChange={() => {}}
    />,
  );
  assert.equal((html.match(/Удалить вариант/g) || []).length, 2);
  assert.match(html, /Остаток SKU MV16/);
  assert.match(html, /Остаток SKU AG16/);
  assert.match(html, /Использовать общее фото/);
  assert.ok(!html.includes('src="/seed/'));
});
