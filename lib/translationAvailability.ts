/** A badge is green only if a published translation matches the current Russian source. */
export type TranslationAvailability = "MISSING" | "REVIEW" | "PUBLISHED" | "STALE";

export function translationAvailability(
  sourceHash: string,
  translation: { sourceHash: string; status: string } | null | undefined,
): TranslationAvailability {
  if (!translation) return "MISSING";
  if (translation.sourceHash !== sourceHash) return "STALE";
  return translation.status === "PUBLISHED" ? "PUBLISHED" : "REVIEW";
}
