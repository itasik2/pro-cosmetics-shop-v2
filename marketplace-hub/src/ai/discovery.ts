type SearchResult = {
  found: boolean;
  url: string | null;
  confidence: number;
  reason: string;
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
  external: () => Promise<SearchResult>;
}) {
  let officialFailure: string | undefined;
  if (input.hasOfficialSources) {
    try {
      const result = await input.official();
      if (result.found && result.url) {
        return {
          url: result.url,
          search: {
            stage: "official" as const,
            confidence: result.confidence,
            reason: result.reason,
          },
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
