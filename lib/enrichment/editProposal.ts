import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { proposalText, type ProposalText } from "./proposalText";

export function proposalTextVersion(
  proposal: ProposalText & { product: { name: string } },
) {
  return createHash("sha256")
    .update(JSON.stringify(proposalText(proposal)))
    .digest("hex");
}

export async function editProposalText(
  input: {
    proposalId: string;
    version: string;
    text: ProposalText;
  },
  database = prisma,
) {
  return database.$transaction(async (tx) => {
    const current = await tx.productEnrichmentProposal.findUnique({
      where: { id: input.proposalId },
      include: { product: { select: { name: true } } },
    });
    if (!current) throw new Error("proposal_not_found");
    if (current.status !== "PENDING") throw new Error("proposal_not_pending");
    if (proposalTextVersion(current) !== input.version)
      throw new Error("proposal_text_changed");
    const text = proposalText({ ...input.text, product: current.product });
    if (!text.title) throw new Error("proposal_title_empty");
    const facts =
      current.facts &&
      typeof current.facts === "object" &&
      !Array.isArray(current.facts)
        ? (current.facts as Record<string, Prisma.JsonValue>)
        : {};
    const previous = facts.adminTextEdit as
      | { titleChanged?: boolean }
      | undefined;
    const written = await tx.productEnrichmentProposal.updateMany({
      where: {
        id: current.id,
        status: "PENDING",
        updatedAt: current.updatedAt,
      },
      data: {
        ...text,
        facts: {
          ...facts,
          adminTextEdit: {
            editedAt: new Date().toISOString(),
            titleChanged:
              previous?.titleChanged === true ||
              text.title !== proposalText(current).title,
          },
        } as Prisma.InputJsonValue,
      },
    });
    if (written.count !== 1) throw new Error("proposal_changed_refresh");
    const saved = { ...text, product: current.product };
    return { id: current.id, ...text, textVersion: proposalTextVersion(saved) };
  });
}
