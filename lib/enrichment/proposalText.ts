import { formatProductName, productDisplayName, type ProductNameIdentity } from "../productNames";
import { customerProductCopy } from "../productCopy";

export type ProposalText = {
  title: string | null;
  shortDescription: string | null;
  description: string | null;
  application: string | null;
  ingredients: string | null;
};

export type EditableProposal = ProposalText & {
  id: string;
  textVersion: string;
  product: ProductNameIdentity;
};

const ADVERTISING =
  /(?:^|[^\p{L}\p{N}])(?:купить|покупайте|заказать|заказывайте|цена|цены|стоимость|доставка|доставкой|интернет[-\s]*магазин[а-яё]*|в\s+магазине|скидк[а-яё]*|распродажа|отзывы|студия\s+красоты|салон\s+красоты)(?=$|[^\p{L}\p{N}])/iu;

function cleanTitle(value: unknown) {
  let title = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  title = title.replace(/^(?:купить|заказать)\s+/iu, "");
  const advertising = title.match(ADVERTISING);
  if (advertising?.index !== undefined)
    title = title.slice(0, advertising.index);
  title = title
    .replace(
      /\s*[|–—-]\s*(?:https?:\/\/)?[\p{L}\d-]+(?:\.[\p{L}\d-]+)+(?:\/\S*)?\s*$/iu,
      "",
    )
    .replace(/[\s|–—:;,\-]+$/u, "")
    .trim();
  return /\p{L}/u.test(title) && title.length >= 2
    ? formatProductName(title)
    : null;
}

export function sanitizeProposalTitle(value: unknown, fallback?: unknown, identity?: ProductNameIdentity) {
  const title = cleanTitle(value) || cleanTitle(fallback);
  return title && identity ? productDisplayName({ ...identity, name: title }) : title;
}

export function proposalText(
  proposal: ProposalText & { product: ProductNameIdentity },
): ProposalText {
  return {
    title: sanitizeProposalTitle(proposal.title, proposal.product.name, proposal.product),
    shortDescription: customerProductCopy(proposal.shortDescription) || null,
    description: customerProductCopy(proposal.description) || null,
    application: customerProductCopy(proposal.application) || null,
    ingredients: customerProductCopy(proposal.ingredients) || null,
  };
}

export function hasManualProposalText(facts: unknown) {
  if (!facts || typeof facts !== "object" || Array.isArray(facts)) return false;
  const edit = (facts as Record<string, unknown>).adminTextEdit;
  return Boolean(edit && typeof edit === "object" && "editedAt" in edit);
}

export function manuallyEditedProductName(proposal: {
  title?: string | null;
  facts: unknown;
  product?: ProductNameIdentity;
}) {
  const facts = proposal.facts as {
    adminTextEdit?: { titleChanged?: boolean };
  } | null;
  return facts?.adminTextEdit?.titleChanged
    ? sanitizeProposalTitle(proposal.title, undefined, proposal.product)
    : null;
}
