import fs from "node:fs";

function patchFile(path, patches) {
  let text = fs.readFileSync(path, "utf8");
  for (const { from, to, label } of patches) {
    if (text.includes(to)) continue;
    if (!text.includes(from)) throw new Error(`${path}: не найден участок: ${label}`);
    text = text.replace(from, to);
  }
  fs.writeFileSync(path, text);
}

patchFile("lib/enrichment/runProductEnrichment.ts", [
  {
    label: "explicit source URL",
    from: `    const policies = toAllowedPolicies(allowedSources);\n    let sourceUrl =\n      input.sourceUrl?.trim() ||\n      product.sourceUrl?.trim() ||\n      product.sources[0]?.url ||\n      \"\";\n    let searchResult: Record<string, unknown> | null = null;`,
    to: `    const policies = toAllowedPolicies(allowedSources);\n    const explicitSourceUrl = input.sourceUrl?.trim() || \"\";\n    let sourceUrl =\n      explicitSourceUrl ||\n      product.sourceUrl?.trim() ||\n      product.sources[0]?.url ||\n      \"\";\n    let searchResult: Record<string, unknown> | null = null;`,
  },
  {
    label: "retry stale source",
    from: `    const requestedSource = findSourceForUrl(allowedSources, sourceUrl);\n    if (!requestedSource) throw new Error(\"source_domain_not_allowed\");\n\n    const fetched = await safeFetchHtml(sourceUrl, policies);\n    const finalSource =\n      findSourceForUrl(allowedSources, fetched.finalUrl) || requestedSource;`,
    to: `    let requestedSource = findSourceForUrl(allowedSources, sourceUrl);\n    if (!requestedSource) throw new Error(\"source_domain_not_allowed\");\n\n    let fetched;\n    try {\n      fetched = await safeFetchHtml(sourceUrl, policies);\n    } catch (error) {\n      const message = errorMessage(error);\n      const staleAutomaticSource =\n        !explicitSourceUrl &&\n        input.discoverIfMissing !== false &&\n        (message === \"source_http_404\" || message === \"source_http_410\");\n\n      if (!staleAutomaticSource) throw error;\n\n      const staleUrl = sourceUrl;\n      await prisma.product.update({\n        where: { id: product.id },\n        data: { sourceUrl: null },\n      });\n\n      const found = await findOfficialProductUrl({\n        product,\n        allowedDomains: allowedSources.map((source) => source.domain),\n      });\n      searchResult = {\n        ...found,\n        retryReason: message,\n        staleUrl,\n      };\n\n      if (!found.found || !found.url || found.url === staleUrl) {\n        throw new Error(\"official_page_not_found_after_stale_source\");\n      }\n\n      sourceUrl = found.url;\n      requestedSource = findSourceForUrl(allowedSources, sourceUrl);\n      if (!requestedSource) throw new Error(\"source_domain_not_allowed\");\n      fetched = await safeFetchHtml(sourceUrl, policies);\n    }\n\n    const finalSource =\n      findSourceForUrl(allowedSources, fetched.finalUrl) || requestedSource;`,
  },
  {
    label: "exclude stale URL on retry",
    from: `      const found = await findOfficialProductUrl({\n        product,\n        allowedDomains: allowedSources.map((source) => source.domain),\n      });\n      searchResult = {\n        ...found,\n        retryReason: message,`,
    to: `      const found = await findOfficialProductUrl({\n        product,\n        allowedDomains: allowedSources.map((source) => source.domain),\n        excludedUrls: [staleUrl],\n      });\n      searchResult = {\n        ...found,\n        retryReason: message,`,
  },
]);

const oldSystem = '      "Найди страницу конкретного товара только на разрешённых официальных доменах. Используй поисковые запросы с ограничением site:домен. Не подставляй страницу категории, поиска, корзины или другого объёма. Если точного совпадения нет, верни found=false. URL должен быть прямой страницей товара.",';
const newSystem = '      "Найди страницу конкретного товара только на разрешённых официальных доменах. Используй поисковые запросы с ограничением site:домен. Не подставляй страницу категории, поиска, корзины или другого объёма. Не возвращай URL из списка исключений. Если точного совпадения нет, верни found=false. URL должен быть прямой страницей товара.",';
const oldUser = '    user: `${productLabel(input.product)}\\n\\nРазрешённые домены: ${allowedDomains.join(", ")}`,';
const newUser = '    user: `${productLabel(input.product)}\\n\\nРазрешённые домены: ${allowedDomains.join(", ")}\\nИсключённые URL: ${(input.excludedUrls || []).join(", ") || "нет"}`,';

patchFile("lib/enrichment/openaiResponses.ts", [
  {
    label: "excluded URL argument",
    from: `export async function findOfficialProductUrl(input: {\n  product: MatchableProduct;\n  allowedDomains: string[];\n}): Promise<SearchResult> {`,
    to: `export async function findOfficialProductUrl(input: {\n  product: MatchableProduct;\n  allowedDomains: string[];\n  excludedUrls?: string[];\n}): Promise<SearchResult> {`,
  },
  { label: "excluded URL system prompt", from: oldSystem, to: newSystem },
  { label: "excluded URL user prompt", from: oldUser, to: newUser },
]);

console.log("Добавлен повторный поиск при 404/410 с исключением нерабочего URL");
