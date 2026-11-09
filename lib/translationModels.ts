/**
 * Translation uses the same model family as the already configured product
 * enrichment service. A legacy GPT-4.x default may be unavailable to modern
 * project-scoped API keys and return model_not_found (HTTP 403).
 *
 * Keep an intentionally small, ordered and deduplicated allow-list. Never
 * retry on quota, invalid key, other permission errors or transient failures:
 * that would waste paid requests and mask the underlying cause.
 */
export function translationModelCandidates(
  explicitTranslationModel: string,
  existingEnrichmentModel: string,
): string[] {
  return Array.from(new Set(
    [
      explicitTranslationModel.trim(),
      existingEnrichmentModel.trim(),
      "gpt-5.6-luna",
      "gpt-4o-mini",
    ].filter(Boolean),
  ));
}

export function translationModelUnavailable(status: number, errorCode: unknown): boolean {
  return (status === 400 || status === 403 || status === 404) && errorCode === "model_not_found";
}
