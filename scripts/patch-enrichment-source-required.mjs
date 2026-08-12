import fs from "node:fs";

function patch(path, replacements) {
  let text = fs.readFileSync(path, "utf8");
  for (const { from, to, label } of replacements) {
    if (text.includes(to)) continue;
    if (!text.includes(from)) throw new Error(`${path}: не найден участок ${label}`);
    text = text.replace(from, to);
  }
  fs.writeFileSync(path, text);
}

patch("lib/enrichment/runProductEnrichment.ts", [
  {
    label: "source required status",
    from: `  } catch (error) {\n    const message = errorMessage(error);\n\n    await prisma.$transaction([\n      prisma.enrichmentJob.update({`,
    to: `  } catch (error) {\n    const message = errorMessage(error);\n    const sourceRequired = [\n      "official_page_not_found",\n      "official_page_not_found_after_stale_source",\n    ].includes(message);\n\n    await prisma.$transaction([\n      prisma.enrichmentJob.update({`,
  },
  {
    label: "product status source required",
    from: `      prisma.product.update({\n        where: { id: input.productId },\n        data: { enrichmentStatus: "FAILED" },\n      }),`,
    to: `      prisma.product.update({\n        where: { id: input.productId },\n        data: { enrichmentStatus: sourceRequired ? "SOURCE_REQUIRED" : "FAILED" },\n      }),`,
  },
]);

patch("app/admin/(private)/enrichment/AdminEnrichmentClient.tsx", [
  {
    label: "source required helpers",
    from: `function statusClass(status: string) {\n  const normalized = status.toUpperCase();\n  if (["READY", "APPLIED", "ACTIVE"].includes(normalized)) {`,
    to: `function isSourceRequiredError(value: string | null | undefined) {\n  return [\n    "official_page_not_found",\n    "official_page_not_found_after_stale_source",\n  ].includes(String(value || "").trim());\n}\n\nfunction enrichmentErrorText(value: string) {\n  if (value === "official_page_not_found") {\n    return "Официальная карточка товара не найдена. Возможно, позиция снята с текущего каталога.";\n  }\n  if (value === "official_page_not_found_after_stale_source") {\n    return "Старый официальный адрес больше не работает, а новая карточка товара не найдена.";\n  }\n  return value;\n}\n\nfunction statusLabel(value: string) {\n  return value.toUpperCase() === "SOURCE_REQUIRED" ? "Нужен источник" : value;\n}\n\nfunction statusClass(status: string) {\n  const normalized = status.toUpperCase();\n  if (["READY", "APPLIED", "ACTIVE"].includes(normalized)) {`,
  },
  {
    label: "source required amber status",
    from: `  if (["REVIEW", "PENDING", "RUNNING"].includes(normalized)) {\n    return "border-amber-200 bg-amber-50 text-amber-800";\n  }`,
    to: `  if (["REVIEW", "PENDING", "RUNNING", "SOURCE_REQUIRED"].includes(normalized)) {\n    return "border-amber-200 bg-amber-50 text-amber-800";\n  }`,
  },
  {
    label: "human status badge",
    from: `      {value}\n    </span>`,
    to: `      {statusLabel(value)}\n    </span>`,
  },
  {
    label: "source required filter",
    from: `              <option value="SEARCHING">В поиске</option>\n              <option value="FAILED">Ошибка</option>`,
    to: `              <option value="SEARCHING">В поиске</option>\n              <option value="SOURCE_REQUIRED">Нужен источник</option>\n              <option value="FAILED">Ошибка</option>`,
  },
  {
    label: "card source required variables",
    from: `              const hasProposal = product.enrichmentProposals.length > 0;\n              const busy = busyKey === \`discover:${product.id}\`;`,
    to: `              const hasProposal = product.enrichmentProposals.length > 0;\n              const busy = busyKey === \`discover:${product.id}\`;\n              const sourceRequired =\n                product.enrichmentStatus === "SOURCE_REQUIRED" ||\n                isSourceRequiredError(lastJob?.error);\n              const displayStatus = sourceRequired ? "SOURCE_REQUIRED" : product.enrichmentStatus;`,
  },
  {
    label: "card display status",
    from: `                          <StatusBadge value={product.enrichmentStatus} />`,
    to: `                          <StatusBadge value={displayStatus} />`,
  },
  {
    label: "human error display",
    from: `                          {lastJob?.error && <div className="text-red-700">Ошибка: {lastJob.error}</div>}`,
    to: `                          {lastJob?.error && (\n                            <div className={sourceRequired ? "text-amber-700" : "text-red-700"}>\n                              {sourceRequired ? "Источник: " : "Ошибка: "}\n                              {enrichmentErrorText(lastJob.error)}\n                            </div>\n                          )}`,
  },
  {
    label: "source required hint and sources button",
    from: `                      <div className="flex flex-wrap gap-2">\n                        <button`,
    to: `                      {sourceRequired && (\n                        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">\n                          Автопоиск по официальным страницам исчерпан. Укажите точный URL из разрешённого источника или добавьте источник во вкладке «Источники».\n                        </div>\n                      )}\n                      <div className="flex flex-wrap gap-2">\n                        <button`,
  },
  {
    label: "sources shortcut",
    from: `                        {lastSource?.url && (\n                          <a`,
    to: `                        {sourceRequired && (\n                          <button\n                            type="button"\n                            className="rounded-xl border px-4 py-2 text-sm hover:bg-gray-50"\n                            onClick={() => setTab("sources")}\n                          >\n                            Источники\n                          </button>\n                        )}\n                        {lastSource?.url && (\n                          <a`,
  },
]);

console.log("Статус SOURCE_REQUIRED и подсказки добавлены");
