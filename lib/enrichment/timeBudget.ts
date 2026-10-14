export const DISCOVERY_BUDGET_MS = 150_000;

export function remainingTime(
  deadlineAt: number,
  preferredMs: number,
  now = Date.now(),
) {
  const remaining = Math.floor(deadlineAt - now);
  if (remaining < 1_000) throw new Error("enrichment_timeout");
  return Math.min(preferredMs, remaining);
}

export function isRecoverableSearchError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /^(?:openai_timeout|openai_empty_output|openai_incomplete_output|openai_search_not_run)$/.test(
      message,
    ) || /^openai_http_(?:500|502|503|504):/.test(message)
  );
}

type SearchResult = {
  found: boolean;
  url: string | null;
  confidence: number;
  reason: string;
};

export async function discoverWithFallback(
  officialSearch: () => Promise<SearchResult | null>,
  externalSearch: () => Promise<SearchResult>,
) {
  const officialResult = await officialSearch().catch((error) => {
    if (!isRecoverableSearchError(error)) throw error;
    return {
      found: false,
      url: null,
      confidence: 0,
      reason: error instanceof Error ? error.message : String(error),
    };
  });
  if (officialResult?.found && officialResult.url) {
    return {
      url: officialResult.url,
      result: { ...officialResult, searchStage: "official" },
    };
  }
  const externalResult = await externalSearch();
  if (
    (!externalResult.found || !externalResult.url) &&
    officialResult &&
    isRecoverableSearchError(new Error(officialResult.reason))
  ) {
    throw new Error("openai_search_incomplete");
  }
  return {
    url: externalResult.found ? externalResult.url : null,
    result: { ...externalResult, searchStage: "external", officialResult },
  };
}
