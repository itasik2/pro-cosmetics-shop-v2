import fs from "node:fs";

const path = "lib/enrichment/runProductEnrichment.ts";
let text = fs.readFileSync(path, "utf8");

function replaceOnce(from, to, label) {
  if (text.includes(to)) return;
  if (!text.includes(from)) throw new Error(`Не найден участок: ${label}`);
  text = text.replace(from, to);
}

replaceOnce(
`    const policies = toAllowedPolicies(allowedSources);\n    let sourceUrl =\n      input.sourceUrl?.trim() ||\n      product.sourceUrl?.trim() ||\n      product.sources[0]?.url ||\n      \"\";\n    let searchResult: Record<string, unknown> | null = null;`,
`    const policies = toAllowedPolicies(allowedSources);\n    const explicitSourceUrl = input.sourceUrl?.trim() || \"\";\n    let sourceUrl =\n      explicitSourceUrl ||\n      product.sourceUrl?.trim() ||\n      product.sources[0]?.url ||\n      \"\";\n    let searchResult: Record<string, unknown> | null = null;`,
"explicit source URL",
);

replaceOnce(
`    const requestedSource = findSourceForUrl(allowedSources, sourceUrl);\n    if (!requestedSource) throw new Error(\"source_domain_not_allowed\");\n\n    const fetched = await safeFetchHtml(sourceUrl, policies);\n    const finalSource =\n      findSourceForUrl(allowedSources, fetched.finalUrl) || requestedSource;`,
`    let requestedSource = findSourceForUrl(allowedSources, sourceUrl);\n    if (!requestedSource) throw new Error(\"source_domain_not_allowed\");\n\n    let fetched;\n    try {\n      fetched = await safeFetchHtml(sourceUrl, policies);\n    } catch (error) {\n      const message = errorMessage(error);\n      const staleAutomaticSource =\n        !explicitSourceUrl &&\n        input.discoverIfMissing !== false &&\n        (message === \"source_http_404\" || message === \"source_http_410\");\n\n      if (!staleAutomaticSource) throw error;\n\n      const staleUrl = sourceUrl;\n      await prisma.product.update({\n        where: { id: product.id },\n        data: { sourceUrl: null },\n      });\n\n      const found = await findOfficialProductUrl({\n        product,\n        allowedDomains: allowedSources.map((source) => source.domain),\n      });\n      searchResult = {\n        ...found,\n        retryReason: message,\n        staleUrl,\n      };\n\n      if (!found.found || !found.url || found.url === staleUrl) {\n        throw new Error(\"official_page_not_found_after_stale_source\");\n      }\n\n      sourceUrl = found.url;\n      requestedSource = findSourceForUrl(allowedSources, sourceUrl);\n      if (!requestedSource) throw new Error(\"source_domain_not_allowed\");\n      fetched = await safeFetchHtml(sourceUrl, policies);\n    }\n\n    const finalSource =\n      findSourceForUrl(allowedSources, fetched.finalUrl) || requestedSource;`,
"retry stale source",
);

fs.writeFileSync(path, text);
console.log("Добавлен повторный поиск при 404/410 автоматического источника");
