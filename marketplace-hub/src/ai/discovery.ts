type SearchResult = {
  found: boolean;
  url: string | null;
  confidence: number;
  reason: string;
};

type DiscoveredSource = {
  url: string;
  search: {
    stage: "official" | "official_unverified" | "external";
    confidence: number;
    reason: string;
    officialFailure?: string;
  };
  officialDomain?: string | null;
};

function recoverableSearchFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /^(?:openai_timeout|openai_empty_output|openai_incomplete_output|openai_search_not_run)$/.test(
      message,
    ) || /^openai_http_(?:500|502|503|504):/.test(message)
  );
}

export async function discoverProductSource(input: {
  hasOfficialSources: boolean;
  allowExternalSearch: boolean;
  official: () => Promise<SearchResult>;
  unconfiguredOfficial?: () => Promise<SearchResult & { domain: string | null }>;
  external: () => Promise<SearchResult>;
}): Promise<DiscoveredSource | null> {
  let officialFailure: string | undefined;
  const officialSearch = input.hasOfficialSources ? input.official : input.unconfiguredOfficial;
  if (officialSearch) {
    try {
      const result = await officialSearch();
      if (result.found && result.url) {
        return {
          url: result.url,
          search: {
            stage: input.hasOfficialSources ? "official" as const : "official_unverified" as const,
            confidence: result.confidence,
            reason: result.reason,
          },
          ...(!input.hasOfficialSources && "domain" in result
            ? { officialDomain: typeof result.domain === "string" ? result.domain : null } : {}),
        };
      }
    } catch (error) {
      if (!input.allowExternalSearch || !recoverableSearchFailure(error))
        throw error;
      officialFailure = error instanceof Error ? error.message : String(error);
    }
  }

  if (input.allowExternalSearch) {
    const result = await input.external();
    if (result.found && result.url) {
      return {
        url: result.url,
        search: {
          stage: "external" as const,
          confidence: result.confidence,
          reason: result.reason,
          ...(officialFailure ? { officialFailure } : {}),
        },
      };
    }
  }
  if (officialFailure) throw new Error("openai_search_incomplete");
  return null;
}
