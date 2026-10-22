import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ProposalTextEditor } from "../components/ProposalTextEditor";
import {
  editProposalText,
  proposalTextVersion,
} from "../lib/enrichment/editProposal";
import {
  proposalText,
  sanitizeProposalTitle,
  hasManualProposalText,
} from "../lib/enrichment/proposalText";
import {
  applyProposalChange,
  publishProposalChange,
  subscribeProposalChanges,
} from "../lib/enrichment/proposalChanges";
import {
  finalizeProductEnrichmentText,
  rejectProductEnrichmentProposal,
} from "../lib/enrichment/applyProposal";
import { applyProductEnrichmentProposalUniversal } from "../lib/enrichment/applyProposalUniversal";
import { evaluateCatalogAutopilotProposal } from "../lib/enrichment/catalogAutopilotPolicy";

const sourceTitle =
  "Спрей анти-акне ANGIOPHARM ANTI ACNE SPRAY – купить в интернет-магазине ПЕРВЫЙ.онлайн";

function fixture() {
  let state: Record<string, any> = {
    product: {
      id: "product",
      name: "Анти-Акне спрей",
      slug: "anti-acne",
      price: 15000,
      stock: 7,
      image: "/original.jpg",
      variants: [],
      supplierId: "supplier",
      description: "Прежнее описание",
      shortDescription: "Прежнее краткое",
      isPublished: false,
      updatedAt: new Date(1000),
    },
    proposal: {
      id: "proposal",
      productId: "product",
      jobId: "job",
      status: "PENDING",
      confidence: 85,
      title: sourceTitle,
      shortDescription: "Краткое описание",
      description: "Полное описание",
      application: "Наносить на очищенную кожу.",
      ingredients: "Aqua, Glycerin",
      sourceUrl: "https://source.example/spray",
      images: [],
      facts: {
        variantImageCandidates: [
          { variantId: "v1", sku: "AA03", candidates: [] },
        ],
        sourcePrice: 16000,
      },
      updatedAt: new Date(1000),
    },
    job: { status: "REVIEW" },
  };
  let clock = 2000;
  const flags = { failProduct: false, failClaim: false };
  function db(get: () => Record<string, any>): any {
    return {
      productEnrichmentProposal: {
        findUnique: async ({ where }: any) =>
          where.id === get().proposal.id
            ? {
                ...structuredClone(get().proposal),
                product: structuredClone(get().product),
                job: structuredClone(get().job),
              }
            : null,
        updateMany: async ({ where, data }: any) => {
          const current = get().proposal;
          if (
            flags.failClaim ||
            (where.status && current.status !== where.status) ||
            (where.updatedAt && +current.updatedAt !== +where.updatedAt)
          )
            return { count: 0 };
          Object.assign(current, structuredClone(data), {
            updatedAt: new Date(clock++),
          });
          return { count: 1 };
        },
        count: async () => (get().proposal.status === "PENDING" ? 1 : 0),
      },
      product: {
        findUniqueOrThrow: async () => structuredClone(get().product),
        update: async ({ data }: any) => {
          if (flags.failProduct) throw new Error("product_refresh_failed");
          return Object.assign(get().product, structuredClone(data));
        },
        updateMany: async ({ data }: any) => {
          Object.assign(get().product, structuredClone(data));
          return { count: 1 };
        },
      },
      enrichmentJob: {
        update: async ({ data }: any) =>
          Object.assign(get().job, structuredClone(data)),
      },
      $transaction: async (callback: (tx: any) => Promise<any>) => {
        const draft = structuredClone(state);
        const result = await callback(db(() => draft));
        state = draft;
        return result;
      },
    };
  }
  const database = db(() => state) as NonNullable<
    Parameters<typeof editProposalText>[1]
  >;
  return {
    database,
    flags,
    get state() {
      return state;
    },
    get proposal() {
      return { ...state.proposal, product: state.product };
    },
  };
}

test("source titles lose advertising suffixes and fall back to the product name when necessary", () => {
  assert.equal(
    sanitizeProposalTitle(sourceTitle),
    "Спрей анти-акне ANGIOPHARM ANTI ACNE SPRAY",
  );
  assert.equal(
    sanitizeProposalTitle("Купить Крем SPF50 — цена и доставка"),
    "Крем SPF50",
  );
  assert.equal(sanitizeProposalTitle("Тоник | ПЕРВЫЙ.онлайн"), "Тоник");
  assert.equal(
    sanitizeProposalTitle(
      "Купить в интернет-магазине ПЕРВЫЙ.онлайн",
      "Анти-Акне спрей",
    ),
    "Анти-Акне спрей",
  );
  assert.equal(sanitizeProposalTitle("купить"), null);
  assert.equal(
    sanitizeProposalTitle("Крем для лица SPF50 (50 мл)"),
    "Крем для лица SPF50 (50 мл)",
  );
});

test("the proposal editor and version check share a SKU-free title while retaining all search identifiers", async () => {
  const f = fixture();
  f.state.product.supplierSku = "SKY117";
  f.state.product.variants = [{ id: "sample", sku: "SKY117/1", label: "3 мл" }];
  f.state.proposal.title = "Маска Skinosophy SKY117";
  const before = structuredClone(f.state.product);
  const text = proposalText(f.proposal);
  assert.equal(text.title, "Маска Skinosophy");
  const saved = await editProposalText({
    proposalId: "proposal", version: proposalTextVersion(f.proposal), text,
  }, f.database);
  assert.equal(saved.title, text.title);
  assert.equal(saved.textVersion, proposalTextVersion(f.proposal));
  assert.deepEqual(f.state.product, before);
  const html = renderToStaticMarkup(<ProposalTextEditor
    proposal={{ ...f.proposal, textVersion: saved.textVersion }} onEditingChange={() => {}}
  />);
  assert.ok(!html.includes("SKY117"));
});

test("editing saves all text in the proposal and leaves the product, photos and inventory untouched", async () => {
  const f = fixture();
  const originalProduct = structuredClone(f.state.product);
  const originalPhotos = structuredClone(
    f.state.proposal.facts.variantImageCandidates,
  );
  const saved = await editProposalText(
    {
      proposalId: "proposal",
      version: proposalTextVersion(f.proposal),
      text: {
        ...proposalText(f.proposal),
        title: "Новый спрей — купить в интернет-магазине",
        shortDescription: "Новое краткое",
        description: "Исправленное описание",
        application: "Исправленное применение",
        ingredients: "Исправленный состав",
      },
    },
    f.database,
  );
  assert.equal(saved.title, "Новый спрей");
  assert.equal(f.state.proposal.description, "Исправленное описание");
  assert.equal(f.state.proposal.application, "Исправленное применение");
  assert.equal(f.state.proposal.ingredients, "Исправленный состав");
  assert.equal(f.state.proposal.status, "PENDING");
  assert.deepEqual(f.state.product, originalProduct);
  assert.deepEqual(
    f.state.proposal.facts.variantImageCandidates,
    originalPhotos,
  );
  assert.equal(f.state.proposal.facts.sourcePrice, 16000);
  assert.equal(hasManualProposalText(f.state.proposal.facts), true);
});

test("photo searches do not stale a text revision, while a competing text edit is rejected", async () => {
  const f = fixture();
  const version = proposalTextVersion(f.proposal);
  f.state.proposal.facts.variantImageCandidates[0].candidates.push({
    url: "https://image.example/aa03.jpg",
    source: "WEB",
  });
  f.state.proposal.updatedAt = new Date(1500);
  const input = {
    proposalId: "proposal",
    version,
    text: {
      ...proposalText(f.proposal),
      description: "Правка из первого окна",
    },
  };
  await editProposalText(input, f.database);
  assert.equal(
    f.state.proposal.facts.variantImageCandidates[0].candidates.length,
    1,
  );
  await assert.rejects(
    editProposalText(
      {
        ...input,
        text: { ...input.text, description: "Правка из устаревшего окна" },
      },
      f.database,
    ),
    /proposal_text_changed/,
  );
  assert.equal(f.state.proposal.description, "Правка из первого окна");
});

test("legacy editorial uncertainty cannot be saved into customer text through either approval path", async () => {
  for (const mode of ["ALL", "DESCRIPTION_FINAL"] as const) {
    const f = fixture();
    f.state.proposal.description = "Маска увлажняет кожу. Точные рекомендации по применению не указаны.";
    f.state.proposal.shortDescription = "Увлажняющая маска. Данные о типе кожи отсутствуют.";
    if (mode === "ALL") await applyProductEnrichmentProposalUniversal({ proposalId: "proposal", mode }, { database: f.database });
    else await finalizeProductEnrichmentText({ proposalId: "proposal", appliedBy: "ADMIN" }, f.database);
    assert.match(f.state.product.description, /^Маска увлажняет кожу\./);
    assert.doesNotMatch(f.state.product.description, /не указаны/);
    assert.equal(f.state.product.shortDescription, "Увлажняющая маска.");
    assert.equal(f.state.product.price, 15000);
    assert.equal(f.state.product.stock, 7);
  }
});

test("manual edits apply through both approval paths and retain price, stock, image and product URL", async () => {
  for (const mode of ["ALL", "DESCRIPTION_FINAL"] as const) {
    const f = fixture();
    await editProposalText(
      {
        proposalId: "proposal",
        version: proposalTextVersion(f.proposal),
        text: {
          ...proposalText(f.proposal),
          title: "Новое название",
          description: "Новый текст",
        },
      },
      f.database,
    );
    if (mode === "ALL")
      await applyProductEnrichmentProposalUniversal(
        { proposalId: "proposal", mode },
        { database: f.database },
      );
    else
      await finalizeProductEnrichmentText(
        { proposalId: "proposal", appliedBy: "ADMIN" },
        f.database,
      );
    assert.equal(f.state.product.name, "Новое название");
    assert.match(f.state.product.description, /^Новый текст/);
    assert.match(f.state.product.description, /Наносить на очищенную кожу/);
    assert.match(f.state.product.description, /Aqua, Glycerin/);
    assert.equal(f.state.product.slug, "anti-acne");
    assert.equal(f.state.product.price, 15000);
    assert.equal(f.state.product.stock, 7);
    assert.equal(f.state.product.image, "/original.jpg");
    assert.equal(f.state.proposal.status, "APPLIED");
  }
});

test("editing description alone does not replace the grouped product name with a source title", async () => {
  const f = fixture();
  await editProposalText(
    {
      proposalId: "proposal",
      version: proposalTextVersion(f.proposal),
      text: { ...proposalText(f.proposal), description: "Новое описание" },
    },
    f.database,
  );
  await applyProductEnrichmentProposalUniversal(
    { proposalId: "proposal", mode: "DESCRIPTION" },
    { database: f.database },
  );
  assert.equal(f.state.product.name, "Анти-Акне спрей");
});

test("manually edited proposals wait for approval rather than automatic application or retries", async () => {
  const f = fixture();
  await editProposalText(
    {
      proposalId: "proposal",
      version: proposalTextVersion(f.proposal),
      text: proposalText(f.proposal),
    },
    f.database,
  );
  await assert.rejects(
    finalizeProductEnrichmentText(
      { proposalId: "proposal", appliedBy: "AUTOPILOT" },
      f.database,
    ),
    /manual_text_review_required/,
  );
  await assert.rejects(
    rejectProductEnrichmentProposal("proposal", f.database, {
      automatic: true,
    }),
    /manual_text_review_required/,
  );
  const evaluation = evaluateCatalogAutopilotProposal(
    { confidence: 60, manualTextEdited: true },
    { enabled: true, minConfidence: 80 },
  );
  assert.equal(evaluation.decision, "REVIEW");
  assert.deepEqual(evaluation.reasons, ["manual_text_review_required"]);
  assert.equal(f.state.proposal.status, "PENDING");
});

test("reject is persistent and repeatable without changing product text or cancelling an applied proposal", async () => {
  const f = fixture();
  const result = await rejectProductEnrichmentProposal("proposal", f.database);
  assert.equal(result?.status, "REJECTED");
  assert.equal(f.state.job.status, "CANCELED");
  assert.equal(f.state.product.description, "Прежнее описание");
  assert.equal(f.state.product.stock, 7);
  assert.equal(f.state.product.enrichmentStatus, "READY");
  await rejectProductEnrichmentProposal("proposal", f.database);
  await assert.rejects(
    editProposalText(
      {
        proposalId: "proposal",
        version: proposalTextVersion(f.proposal),
        text: proposalText(f.proposal),
      },
      f.database,
    ),
    /proposal_not_pending/,
  );
  f.state.proposal.status = "APPLIED";
  f.state.job.status = "APPLIED";
  await assert.rejects(
    rejectProductEnrichmentProposal("proposal", f.database),
    /proposal_not_pending/,
  );
  assert.equal(f.state.job.status, "APPLIED");
});

test("a failed status refresh or a lost reject race cannot partially reject the proposal", async () => {
  for (const flag of ["failProduct", "failClaim"] as const) {
    const f = fixture();
    f.flags[flag] = true;
    await assert.rejects(
      rejectProductEnrichmentProposal("proposal", f.database),
    );
    assert.equal(f.state.proposal.status, "PENDING");
    assert.equal(f.state.job.status, "REVIEW");
  }
});

test("edits and rejection update both proposal lists and remove only the selected proposal", () => {
  const target = new EventTarget();
  let a = [
    { id: "proposal", title: "Старый" },
    { id: "other", title: "Другой" },
  ];
  let b = structuredClone(a);
  const stopA = subscribeProposalChanges((change) => {
    a = applyProposalChange(a, change);
  }, target);
  const stopB = subscribeProposalChanges((change) => {
    b = applyProposalChange(b, change);
  }, target);
  publishProposalChange(
    {
      id: "proposal",
      status: "PENDING",
      text: {
        title: "Новый",
        shortDescription: null,
        description: "Текст",
        application: null,
        ingredients: null,
        textVersion: "new",
      },
    },
    target,
  );
  assert.equal(a[0].title, "Новый");
  assert.equal(b[0].title, "Новый");
  publishProposalChange({ id: "proposal", status: "REJECTED" }, target);
  assert.deepEqual(
    a.map((row) => row.id),
    ["other"],
  );
  assert.deepEqual(
    b.map((row) => row.id),
    ["other"],
  );
  stopA();
  stopB();
});

test("the proposal exposes inline text editing and does not display the advertising source title", () => {
  const f = fixture();
  const markup = renderToStaticMarkup(
    <ProposalTextEditor
      proposal={{ ...f.proposal, textVersion: proposalTextVersion(f.proposal) }}
      onEditingChange={() => {}}
    />,
  );
  assert.match(markup, /Редактировать текст/);
  assert.match(markup, /Состав и активные компоненты/);
  assert.match(markup, /Способ применения/);
  assert.ok(!markup.includes("ПЕРВЫЙ.онлайн"));
  assert.ok(!markup.includes("купить в интернет-магазине"));
});

test("automatic photo and text application fills the matching variant without changing prices or publication", async () => {
  const f = fixture();
  f.state.product.variants = [
    { id: "v1", sku: "AA03", label: "50 мл", price: 15000, stock: 7 },
  ];
  const imageUrl = "https://source.example/aa03.jpg";
  f.state.proposal.facts.variantImageCandidates[0].candidates = [
    { url: imageUrl, source: "WEB" },
  ];
  await applyProductEnrichmentProposalUniversal(
    {
      proposalId: "proposal",
      mode: "IMAGE",
      automatic: true,
      variantImages: [{ variantId: "v1", sku: "AA03", imageUrl }],
    },
    {
      database: f.database,
      loadPriceImages: async () => new Map(),
      importImage: async () =>
        ({ id: "media", url: "https://media.example/aa03.jpg" }) as any,
    },
  );
  assert.equal(f.state.proposal.status, "PENDING");
  await finalizeProductEnrichmentText(
    { proposalId: "proposal", appliedBy: "AUTOPILOT" },
    f.database,
  );
  assert.equal(f.state.proposal.status, "APPLIED");
  assert.equal(
    f.state.product.variants[0].image,
    "https://media.example/aa03.jpg",
  );
  assert.equal(f.state.product.image, "/original.jpg");
  assert.equal(f.state.product.stock, 7);
  assert.equal(f.state.product.price, 15000);
  assert.equal(f.state.product.isPublished, false);
  assert.match(f.state.product.description, /Полное описание/);
});

test("a manual variant removal blocks both automatic photo application and text approval", async () => {
  const f = fixture();
  f.state.proposal.facts.manualVariantReviewRequired = true;
  const before = structuredClone(f.state);
  await assert.rejects(
    applyProductEnrichmentProposalUniversal(
      { proposalId: "proposal", mode: "IMAGE", automatic: true },
      { database: f.database },
    ),
    /manual_variant_review_required/,
  );
  await assert.rejects(
    finalizeProductEnrichmentText(
      { proposalId: "proposal", appliedBy: "AUTOPILOT" },
      f.database,
    ),
    /manual_variant_review_required/,
  );
  assert.deepEqual(f.state, before);
});
