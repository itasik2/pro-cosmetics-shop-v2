type CopyField = "shortDescription" | "description" | "application" | "ingredients";
export function buildEnrichmentPatch(input: {
  current: Record<string, unknown>;
  proposal: Partial<Record<CopyField | "title" | "brand", string | null>>;
  includeTitle?: boolean; includeBrand?: boolean;
  selectedImageUrl?: string; replaceFilledFields?: boolean;
}) {
  const patch: Record<string, string | string[]> = {};
  const fields: Array<CopyField | "title" | "brand"> = ["shortDescription", "description", "application", "ingredients"];
  if (input.includeTitle) fields.push("title");
  if (input.includeBrand) fields.push("brand");
  for (const field of fields) {
    const value = input.proposal[field]?.trim();
    const before = input.current[field];
    if (value && (input.replaceFilledFields || typeof before !== "string" || !before.trim()) && before !== value) patch[field] = value;
  }
  const before = input.current.images;
  if (input.selectedImageUrl && (input.replaceFilledFields || !Array.isArray(before) || !before.length)) {
    const images = [input.selectedImageUrl];
    if (JSON.stringify(before) !== JSON.stringify(images)) patch.images = images;
  }
  return patch;
}
