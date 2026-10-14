export type EnrichmentAction =
  | { action: "create"; sku: string; sourceUrl?: string; supplierCode?: string }
  | { action: "source"; supplierCode: string; name: string; sourceUrl: string; sourceType: "OFFICIAL_SITE" | "DISTRIBUTOR" }
  | { action: "run"; id: string }
  | { action: "stage"; id: string; selectedImageUrl?: string; selectedMediaVariantId?: string; replaceFilledFields: boolean };

export function parseEnrichmentAction(raw: unknown): EnrichmentAction {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("invalid_body");
  const value = raw as Record<string, unknown>;
  const text = (field: string) => {
    const v = value[field];
    if (typeof v !== "string" || !v.trim() || v.length > 128) throw new Error("invalid_" + field);
    return v.trim();
  };
  const url = (field: string) => {
    if (value[field] === undefined || value[field] === "") return undefined;
    if (typeof value[field] !== "string" || (value[field] as string).length > 2048) throw new Error("invalid_" + field);
    const parsed = new URL(value[field] as string);
    if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error("invalid_" + field);
    return parsed.href;
  };
  if (value.action === "create") return { action: "create", sku: text("sku"), sourceUrl: url("sourceUrl"), supplierCode: value.supplierCode ? text("supplierCode") : undefined };
  if (value.action === "source") {
    const sourceUrl = url("sourceUrl");
    if (!sourceUrl || !["OFFICIAL_SITE", "DISTRIBUTOR"].includes(String(value.sourceType))) throw new Error("invalid_source");
    return { action: "source", supplierCode: text("supplierCode"), name: text("name"), sourceUrl, sourceType: value.sourceType as "OFFICIAL_SITE" | "DISTRIBUTOR" };
  }
  if (value.action === "run") return { action: "run", id: text("id") };
  if (value.action === "stage") {
    if (value.replaceFilledFields !== undefined && typeof value.replaceFilledFields !== "boolean") throw new Error("invalid_replaceFilledFields");
    return { action: "stage", id: text("id"), selectedImageUrl: url("selectedImageUrl"), selectedMediaVariantId: value.selectedMediaVariantId ? text("selectedMediaVariantId") : undefined, replaceFilledFields: value.replaceFilledFields === true };
  }
  throw new Error("invalid_action");
}
