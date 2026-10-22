import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { VariantPhotosReview } from "../components/VariantPhotoPicker";
import {
  automaticPhotoPlan,
  commonPhotoCandidates,
  mergeAutomaticSelections,
} from "../lib/enrichment/automaticPhotos";
import { collectProposalPhotos } from "../lib/enrichment/prepareProposalPhotos";
import { removeProposalVariant } from "../lib/enrichment/removeProposalVariant";
import { applyProductEnrichmentProposalUniversal } from "../lib/enrichment/applyProposalUniversal";
import { proposalApplySchema } from "../lib/enrichment/proposalApplyInput";
import {
  removedVariantSkus,
  shouldSkipRemovedVariant,
} from "../lib/enrichment/removedVariants";
import { extractProductFromHtml } from "../lib/enrichment/extractProduct";
import { searchVariantPhotos } from "../lib/enrichment/variantPhotoSearch";
import { sanitizeProposalTitle } from "../lib/enrichment/proposalText";
import { evaluateCatalogAutopilotProposal } from "../lib/enrichment/catalogAutopilotPolicy";
import type { VariantImageGroup } from "../lib/enrichment/variantImages";
import { namePhotoKey } from "../lib/enrichment/photoIdentity";

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

test("a missing common photo is suggested from any current variant while a saved common photo stays selected", () => {
  const current = { ...product, variants: [variants[0], { ...variants[1], image: "/media/large.jpg" }] };
  const plan = automaticPhotoPlan(current, {});
  assert.equal(plan.imageUrl, "/media/large.jpg");
  assert.deepEqual(plan.variantImages, []);
  assert.equal(commonPhotoCandidates(current, {})[0].sku, "AG16");
  const duplicate = commonPhotoCandidates({
    ...current, variants: [variants[0], { ...variants[1], image: groups[1].candidates[0].url }],
  }, { variantImageCandidates: groups });
  assert.equal(duplicate.find(row => row.url === groups[1].candidates[0].url)?.stored, true);
  assert.equal(automaticPhotoPlan({ ...current, image: "/media/current.jpg" }, {}).imageUrl, null);
  const html = renderToStaticMarkup(<VariantPhotosReview
    product={current} proposalId="proposal" facts={{}} value={[]}
    onChange={() => {}} onCommonImageChange={() => {}}
  />);
  assert.match(html, /Сделать фото варианта AG16 общим/);
  assert.match(html, /Сделать общим фото товара/);
});

test("batch SKU lookup continues to the same verified external search as a manual variant search", async () => {
  const lookedUp: string[] = [];
  const photos = await collectProposalPhotos({
    product, groups: [], knownUrl: "https://brand.example/wrong-page",
    officialDomains: [], policies: [], deadlineAt: Date.now() + 5000,
  }, input => searchVariantPhotos(input, {
    official: async () => { throw new Error("no official domains"); },
    external: async ({ product: current }) => {
      lookedUp.push(current.supplierSku!);
      return { found: true, url: "https://merchant.example/" + current.supplierSku };
    },
    fetchHtml: async (url) => {
      const sku = url.split("/").at(-1)!;
      const volume = sku === "MV16" ? 7 : 50;
      return { finalUrl: url, contentType: "text/html", status: 200, headers: {},
        buffer: Buffer.from(`<script type="application/ld+json">${JSON.stringify({
          "@type": "Product", name: `${product.name} ${volume} ml`, sku,
          brand: "ANGIOPHARM", image: `/${sku}.jpg`,
        })}</script>`),
      };
    },
  }));
  assert.deepEqual(lookedUp.sort(), ["AG16", "MV16"]);
  assert.deepEqual(photos.photoAutomation.issues, []);
  assert.deepEqual(automaticPhotoPlan(product, photos).variantImages.map(row => row.imageUrl).sort(), [
    "https://merchant.example/AG16.jpg", "https://merchant.example/MV16.jpg",
  ]);
});

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
      assert.equal(input.catalogOnly, false);
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
      ...structuredClone(product),
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

test("a verified sibling SKU photo can become common and own photo with one upload and no inventory changes", async () => {
  const f = deletionFixture();
  f.state.proposals[0].images = [];
  const before = structuredClone(f.state.product);
  let uploads = 0;
  await applyProductEnrichmentProposalUniversal({
    proposalId: "proposal", mode: "ALL", imageUrl: groups[1].candidates[0].url,
    variantImages: [{ variantId: "large", sku: "AG16", imageUrl: groups[1].candidates[0].url }],
  }, {
    database: f.database, loadPriceImages: async () => new Map(),
    importImage: async () => { uploads++; return { id: "media", url: "https://media.example/large.jpg" } as any; },
  });
  assert.equal(uploads, 1);
  assert.equal(f.state.product.image, "https://media.example/large.jpg");
  assert.equal(f.state.product.variants[1].image, f.state.product.image);
  assert.equal(f.state.product.variants[0].image, undefined);
  for (const key of ["price", "stock", "supplierSku", "isPublished"]) assert.equal(f.state.product[key], before[key]);
});

test("promoting a stored variant photo reuses its URL and preserves every SKU photo, price and stock", async () => {
  const f = deletionFixture();
  f.state.product.variants[1].image = "/media/approved-large.jpg";
  const before = structuredClone(f.state.product);
  const plan = automaticPhotoPlan(f.state.product, {});
  assert.equal(plan.imageUrl, "/media/approved-large.jpg");
  assert.equal(proposalApplySchema.parse({ imageUrl: plan.imageUrl }).imageUrl, plan.imageUrl);
  await applyProductEnrichmentProposalUniversal({
    proposalId: "proposal", mode: "IMAGE", imageUrl: plan.imageUrl,
  }, { database: f.database, importImage: async () => { throw new Error("stored photo must not be downloaded again"); } });
  assert.equal(f.state.product.image, plan.imageUrl);
  assert.deepEqual(f.state.product.variants, before.variants);
  for (const key of ["price", "stock", "supplierSku", "isPublished"]) assert.equal(f.state.product[key], before[key]);
});

test("promotion of a non-primary photo fails if its SKU changes during upload", async () => {
  const f = deletionFixture();
  await assert.rejects(applyProductEnrichmentProposalUniversal({
    proposalId: "proposal", mode: "IMAGE", imageUrl: groups[1].candidates[0].url,
  }, {
    database: f.database,
    importImage: async () => {
      f.state.product.variants[1].sku = "AG17";
      f.state.product.updatedAt = new Date(5000);
      return { id: "media", url: "https://media.example/large.jpg" } as any;
    },
  }), /variant_sku_changed/);
  assert.equal(f.state.product.image, product.image);
  assert.equal(f.state.product.variants[1].image, undefined);
  assert.equal(f.state.proposals[0].status, "PENDING");
});

test("an explicit decision to keep the current common photo still saves text and each SKU photo", async () => {
  const f = deletionFixture();
  const plan = automaticPhotoPlan(f.state.product, {
    variantImageCandidates: [groups[1]],
  });
  assert.equal(plan.imageUrl, groups[1].candidates[0].url);
  const parsed = proposalApplySchema.parse(
    JSON.parse(
      JSON.stringify({
        mode: "ALL",
        imageUrl: null,
        variantImages: plan.variantImages,
      }),
    ),
  );
  assert.equal(parsed.mode, "ALL");
  assert.equal(parsed.imageUrl, null);
  const before = structuredClone(f.state.product);
  const result = await applyProductEnrichmentProposalUniversal(
    {
      proposalId: "proposal",
      ...parsed,
      mode: "ALL",
    },
    {
      database: f.database,
      loadPriceImages: async () => new Map(),
      importImage: async ({ sourceUrl }) => {
        assert.equal(sourceUrl, groups[1].candidates[0].url);
        return { id: "photo", url: "https://media.example/AG16.jpg" } as any;
      },
    },
  );
  assert.equal(f.state.proposals[0].status, "APPLIED");
  assert.equal(
    f.state.product.shortDescription,
    f.state.proposals[0].shortDescription,
  );
  assert.equal(f.state.product.description, f.state.proposals[0].description);
  assert.equal(
    result.proposal?.product.description,
    f.state.product.description,
  );
  assert.equal(f.state.product.image, before.image);
  assert.equal(f.state.product.variants[0].image, undefined);
  assert.equal(
    f.state.product.variants[1].image,
    "https://media.example/AG16.jpg",
  );
  assert.equal(f.state.product.supplierSku, before.supplierSku);
  assert.equal(f.state.product.price, before.price);
  assert.equal(f.state.product.stock, before.stock);
  assert.deepEqual(
    f.state.product.variants.map(({ id, label, sku, price, stock }: any) => ({
      id,
      label,
      sku,
      price,
      stock,
    })),
    before.variants,
  );
});

test("photo selection accepts an unchanged common photo but still rejects malformed variant assignments", () => {
  for (const imageUrl of [
    null,
    undefined,
    "",
    "https://brand.example/photo.jpg",
  ])
    assert.equal(
      proposalApplySchema.safeParse({ mode: "ALL", imageUrl }).success,
      true,
    );
  for (const body of [
    { imageUrl: 1 },
    { imageUrl: "not-a-url" },
    { imageUrl: "//another.example/photo.jpg" },
    { imageUrl: "file:///private.jpg" },
    { imageUrl: "javascript:alert(1)" },
    { variantImages: [{ variantId: "large", sku: "", imageUrl: null }] },
    {
      variantImages: [
        { variantId: "large", sku: "AG16", imageUrl: "/local.jpg" },
      ],
    },
    { stock: -1 },
  ])
    assert.equal(proposalApplySchema.safeParse(body).success, false);
});

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

test("a photo belonging to a removed variant or another product cannot become the common photo", async () => {
  for (const target of ["removed", "foreign-product"]) {
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

function namedApplicationFixture() {
  const f = deletionFixture();
  Object.assign(f.state.product, {
    name: "Demela Molecular Cream",
    brandId: "jeuderm",
    brand: { name: "JeuDerm" },
    supplierSku: "JD-01ABCDE",
    volumeValue: 50,
    volumeUnit: "ml",
    image: "",
    variants: [],
  });
  const candidate = {
    url: "https://brand.example/demela-50.jpg",
    source: "WEB" as const,
    identityKey: namePhotoKey(f.state.product),
  };
  f.state.proposals[0].images = [candidate.url];
  f.state.proposals[0].facts = {
    productImageCandidates: [
      {
        variantId: "product:p",
        sku: f.state.product.supplierSku,
        candidates: [candidate],
      },
    ],
  };
  return {
    ...f,
    get state() {
      return f.state;
    },
    candidate,
  };
}

test("applying a verified name-based common photo saves text and preserves price, stock and publication", async () => {
  for (const sku of ["JD-01ABCDE", null]) {
    const f = namedApplicationFixture();
    f.state.product.supplierSku = sku;
    f.state.proposals[0].facts.productImageCandidates[0].sku = sku || "";
    const plan = automaticPhotoPlan(
      f.state.product,
      f.state.proposals[0].facts,
    );
    assert.equal(plan.imageUrl, f.candidate.url);
    const before = structuredClone(f.state.product);
    await applyProductEnrichmentProposalUniversal(
      {
        proposalId: "proposal",
        mode: "ALL",
        imageUrl: plan.imageUrl,
      },
      {
        database: f.database,
        importImage: async () =>
          ({ id: "media", url: "https://media.example/demela.jpg" }) as any,
      },
    );
    assert.equal(f.state.product.image, "https://media.example/demela.jpg");
    assert.equal(f.state.product.description, f.state.proposals[0].description);
    assert.equal(f.state.product.price, before.price);
    assert.equal(f.state.product.stock, before.stock);
    assert.equal(f.state.product.isPublished, before.isPublished);
    assert.equal(f.state.proposals[0].status, "APPLIED");
  }
});

test("legacy proposal image arrays cannot bypass a stale name, brand or volume fingerprint", async () => {
  for (const change of [
    { name: "Demela Molecular Oil" },
    { brandId: "different-brand" },
    { volumeValue: 150 },
  ]) {
    const f = namedApplicationFixture();
    Object.assign(f.state.product, change);
    assert.equal(
      automaticPhotoPlan(f.state.product, f.state.proposals[0].facts).imageUrl,
      null,
    );
    await assert.rejects(
      applyProductEnrichmentProposalUniversal(
        {
          proposalId: "proposal",
          mode: "ALL",
          imageUrl: f.candidate.url,
        },
        {
          database: f.database,
          importImage: async () => {
            throw new Error("must not upload");
          },
        },
      ),
      /product_changed_refresh/,
    );
    assert.equal(f.state.product.image, "");
    assert.equal(f.state.proposals[0].status, "PENDING");
  }
});

test("identity changed during a named-photo upload rolls back text, photo and proposal status", async () => {
  for (const change of [
    { name: "Demela Molecular Oil" },
    { brandId: "different-brand" },
    { volumeValue: 150 },
  ]) {
    const f = namedApplicationFixture();
    await assert.rejects(
      applyProductEnrichmentProposalUniversal(
        {
          proposalId: "proposal",
          mode: "ALL",
          imageUrl: f.candidate.url,
        },
        {
          database: f.database,
          importImage: async () => {
            Object.assign(f.state.product, change);
            return {
              id: "media",
              url: "https://media.example/demela.jpg",
            } as any;
          },
        },
      ),
      /product_changed_refresh/,
    );
    assert.equal(f.state.product.description, undefined);
    assert.equal(f.state.product.image, "");
    assert.equal(f.state.proposals[0].status, "PENDING");
  }
});

test("a synthetic-SKU variant cannot receive a named photo after its label changes during upload", async () => {
  const f = namedApplicationFixture();
  const variant = {
    id: "cream50",
    sku: "JD-01ABCDE",
    label: "50 ml",
    price: 1500,
    stock: 5,
  };
  f.state.product.variants = [variant];
  f.candidate.identityKey = namePhotoKey(f.state.product, variant);
  f.state.proposals[0].facts = {
    variantImageCandidates: [
      { variantId: variant.id, sku: variant.sku, candidates: [f.candidate] },
    ],
  };
  await assert.rejects(
    applyProductEnrichmentProposalUniversal(
      {
        proposalId: "proposal",
        mode: "ALL",
        variantImages: [
          {
            variantId: variant.id,
            sku: variant.sku,
            imageUrl: f.candidate.url,
          },
        ],
      },
      {
        database: f.database,
        loadPriceImages: async () => new Map(),
        importImage: async () => {
          f.state.product.variants[0].label = "150 ml";
          return {
            id: "media",
            url: "https://media.example/demela.jpg",
          } as any;
        },
      },
    ),
    /variant_image_not_allowed/,
  );
  assert.equal(f.state.product.variants[0].image, undefined);
  assert.equal(f.state.product.description, undefined);
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
