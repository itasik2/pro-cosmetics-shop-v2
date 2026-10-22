import { isRecoverableSearchError, remainingTime } from "./timeBudget";

export type SourceStage = "saved" | "catalog" | "official" | "external";
export type SourceSearchResult = {
  found: boolean;
  url: string | null;
  confidence: number;
  reason: string;
};
type RejectedSource = { url: string; stage: SourceStage; reason: string };

export function sourceUrlKey(value: string) {
  try {
    const url = new URL(value);
    url.hash = "";
    url.searchParams.sort();
    url.pathname = url.pathname.replace(/\/$/, "") || "/";
    return url.toString();
  } catch {
    return value.trim();
  }
}

export function isRecoverableSourceError(message: string) {
  return (
    [
      "source_timeout",
      "source_dns_not_found",
      "source_redirect_without_location",
      "source_too_many_redirects",
      "source_access_blocked",
    ].includes(message) ||
    /^source_(?:fetch_failed|content_type_not_allowed):/.test(message) ||
    /^source_http_(?:403|404|410|429|5\d\d)$/.test(message) ||
    /\b(?:EAI_AGAIN|ENOTFOUND|ECONNRESET|ETIMEDOUT)\b/.test(message)
  );
}

// Search results are candidates. An official URL only wins after its page has
// been fetched and matched; otherwise continue to the next independent source.
export async function resolveProductSource<T>(input: {
  initialUrl?: string;
  explicit?: boolean;
  discover: boolean;
  excludedUrls: string[];
  deadlineAt: number;
  stages: {
    stage: Exclude<SourceStage, "saved">;
    find: (excludedUrls: string[]) => Promise<SourceSearchResult | null>;
  }[];
  inspect: (url: string, stage: SourceStage) => Promise<T>;
  onRejected?: (source: RejectedSource) => Promise<void>;
}) {
  const excluded = new Set(input.excludedUrls.map(sourceUrlKey));
  const excludedUrls = [...input.excludedUrls];
  const rejected: RejectedSource[] = [];
  let incompleteSearch = false;
  let incompleteCatalog = false;

  async function inspect(url: string, stage: SourceStage) {
    const key = sourceUrlKey(url);
    if (excluded.has(key)) return null;
    excluded.add(key);
    excludedUrls.push(url);
    remainingTime(input.deadlineAt, 1_000);
    try {
      return { value: await input.inspect(url, stage) };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (
        input.explicit ||
        !input.discover ||
        (!isRecoverableSourceError(reason) &&
          reason !== "product_match_zero_confidence")
      )
        throw error;
      const failure = { url, stage, reason };
      rejected.push(failure);
      await input.onRejected?.(failure);
      return null;
    }
  }

  if (input.initialUrl) {
    // A newly supplied manual URL takes precedence over an older retry list.
    if (input.explicit) excluded.delete(sourceUrlKey(input.initialUrl));
    const saved = await inspect(input.initialUrl, "saved");
    if (saved)
      return {
        ...saved,
        searchResult: { searchStage: "saved", rejectedSources: rejected },
      };
  }
  if (!input.discover) throw new Error("source_url_required");

  for (const stage of input.stages) {
    remainingTime(input.deadlineAt, 1_000);
    let candidate: SourceSearchResult | null;
    try {
      candidate = await stage.find([...excludedUrls]);
    } catch (error) {
      // Configuration, credential, domain-policy and private-network failures
      // remain fatal; trying another service cannot fix those errors.
      if (!isRecoverableSearchError(error)) throw error;
      incompleteSearch = true;
      continue;
    }
    if (!candidate?.found || !candidate.url) {
      if (candidate?.reason === "catalog_lookup_incomplete")
        incompleteCatalog = true;
      continue;
    }
    const usable = await inspect(candidate.url, stage.stage);
    if (usable)
      return {
        ...usable,
        searchResult: {
          ...candidate,
          searchStage: stage.stage,
          rejectedSources: rejected,
        },
      };
  }
  if (incompleteSearch) throw new Error("openai_search_incomplete");
  if (
    incompleteCatalog ||
    rejected.some((source) => isRecoverableSourceError(source.reason))
  )
    throw new Error("product_sources_unavailable");
  if (
    rejected.some((source) => source.reason === "product_match_zero_confidence")
  )
    throw new Error("product_match_zero_confidence");
  throw new Error("product_page_not_found");
}
