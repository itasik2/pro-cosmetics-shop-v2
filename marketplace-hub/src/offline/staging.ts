import { z } from "zod";
import {
  masterCardSchema,
  type MasterCardInput,
} from "./master-card.js";

export const mutableCardFields = [
  "barcode",
  "title",
  "brand",
  "description",
  "categoryKey",
  "attributes",
  "images",
  "purchasePrice",
  "price",
  "stock",
] as const;

export type MutableCardField = (typeof mutableCardFields)[number];
export type ChangeRisk = "LOW" | "MEDIUM" | "HIGH";

const mutableFieldSchema = z.enum(mutableCardFields);

export const stagingPatchSchema = masterCardSchema
  .omit({ sku: true })
  .partial();

export const stagingDiffRequestSchema = z.object({
  current: masterCardSchema,
  proposed: stagingPatchSchema,
});

export const stagingApplyRequestSchema = z.object({
  current: masterCardSchema,
  proposed: stagingPatchSchema,
  approvedFields: z.array(mutableFieldSchema).min(1),
});

export type StagingPatch = z.infer<typeof stagingPatchSchema>;

function stableJson(value: unknown) {
  if (value === undefined) return "__undefined__";
  return JSON.stringify(value, Object.keys(value as object ?? {}).sort());
}

function equalValue(left: unknown, right: unknown) {
  if (
    left &&
    right &&
    typeof left === "object" &&
    typeof right === "object"
  ) {
    return JSON.stringify(left) === JSON.stringify(right);
  }
  return Object.is(left, right);
}

export function fieldRisk(field: MutableCardField): ChangeRisk {
  if (
    field === "purchasePrice" ||
    field === "price" ||
    field === "stock"
  ) {
    return "HIGH";
  }
  if (field === "images" || field === "attributes") {
    return "MEDIUM";
  }
  return "LOW";
}

export function buildCardDiff(
  currentInput: MasterCardInput,
  proposedInput: StagingPatch,
) {
  const current = masterCardSchema.parse(currentInput);
  const proposed = stagingPatchSchema.parse(proposedInput);

  const changes = mutableCardFields.flatMap((field) => {
    if (!Object.prototype.hasOwnProperty.call(proposed, field)) return [];

    const before = current[field];
    const after = proposed[field];
    if (equalValue(before, after)) return [];

    return [
      {
        field,
        before: before ?? null,
        after: after ?? null,
        risk: fieldRisk(field),
        requiresExplicitApproval: fieldRisk(field) !== "LOW",
      },
    ];
  });

  const summary = {
    total: changes.length,
    lowRisk: changes.filter((change) => change.risk === "LOW").length,
    mediumRisk: changes.filter((change) => change.risk === "MEDIUM").length,
    highRisk: changes.filter((change) => change.risk === "HIGH").length,
    changedFields: changes.map((change) => change.field),
  };

  return {
    sku: current.sku,
    changes,
    summary,
    hasChanges: changes.length > 0,
  };
}

export function applyApprovedChanges(input: {
  current: MasterCardInput;
  proposed: StagingPatch;
  approvedFields: MutableCardField[];
}) {
  const current = masterCardSchema.parse(input.current);
  const proposed = stagingPatchSchema.parse(input.proposed);
  const approvedFields = [
    ...new Set(input.approvedFields.map((field) => mutableFieldSchema.parse(field))),
  ];

  const diff = buildCardDiff(current, proposed);
  const changedFields = new Set(diff.changes.map((change) => change.field));

  const revised: Record<string, unknown> = { ...current };
  const appliedFields: MutableCardField[] = [];
  const skippedFields: MutableCardField[] = [];

  for (const field of approvedFields) {
    if (
      !changedFields.has(field) ||
      !Object.prototype.hasOwnProperty.call(proposed, field)
    ) {
      skippedFields.push(field);
      continue;
    }

    revised[field] = proposed[field];
    appliedFields.push(field);
  }

  const validated = masterCardSchema.parse(revised);
  const remaining = buildCardDiff(validated, proposed);

  return {
    previous: current,
    revised: validated,
    appliedFields,
    skippedFields,
    remainingChanges: remaining.changes,
    fullyApplied: remaining.changes.length === 0,
    revision: {
      sku: current.sku,
      appliedFields,
      before: current,
      after: validated,
      createdAt: new Date().toISOString(),
    },
  };
}

export function suggestedApprovalGroups(
  current: MasterCardInput,
  proposed: StagingPatch,
) {
  const diff = buildCardDiff(current, proposed);

  return {
    safeText: diff.changes
      .filter((change) => change.risk === "LOW")
      .map((change) => change.field),
    media: diff.changes
      .filter((change) => change.risk === "MEDIUM")
      .map((change) => change.field),
    commercial: diff.changes
      .filter((change) => change.risk === "HIGH")
      .map((change) => change.field),
  };
}
