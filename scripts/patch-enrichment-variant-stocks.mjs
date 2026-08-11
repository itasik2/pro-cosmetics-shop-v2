import fs from "node:fs";

const path = "app/admin/(private)/enrichment/AdminEnrichmentClient.tsx";
let text = fs.readFileSync(path, "utf8");

function replaceOnce(from, to, label) {
  if (text.includes(to)) return;
  if (!text.includes(from)) throw new Error(`Не найден участок: ${label}`);
  text = text.replace(from, to);
}

replaceOnce(
`    description: string;\n    stock: number;\n    isPublished: boolean;`,
`    description: string;\n    stock: number;\n    variants: unknown;\n    isPublished: boolean;`,
"тип variants",
);

replaceOnce(
`function stringArray(value: unknown) {\n  return Array.isArray(value)\n    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)\n    : [];\n}\n`,
`function stringArray(value: unknown) {\n  return Array.isArray(value)\n    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)\n    : [];\n}\n\ntype ProposalVariant = {\n  id: string;\n  label: string;\n  price: number;\n  stock: number;\n  sku?: string;\n};\n\nfunction proposalVariants(value: unknown): ProposalVariant[] {\n  if (!Array.isArray(value)) return [];\n  return value\n    .map((raw) => {\n      const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};\n      return {\n        id: String(row.id || ""),\n        label: String(row.label || ""),\n        price: Math.max(0, Math.trunc(Number(row.price) || 0)),\n        stock: Math.max(0, Math.trunc(Number(row.stock) || 0)),\n        sku: row.sku ? String(row.sku) : undefined,\n      };\n    })\n    .filter((variant) => variant.id && variant.label);\n}\n`,
"helper вариантов",
);

replaceOnce(
`  const [stockValues, setStockValues] = useState<Record<string, string>>({});\n  const [sourceForm, setSourceForm] = useState<SourceForm>(emptySourceForm);`,
`  const [stockValues, setStockValues] = useState<Record<string, string>>({});\n  const [variantStockValues, setVariantStockValues] = useState<Record<string, Record<string, string>>>({});\n  const [sourceForm, setSourceForm] = useState<SourceForm>(emptySourceForm);`,
"state остатков вариантов",
);

replaceOnce(
`    setStockValues((current) => {\n      const next: Record<string, string> = {};\n      for (const proposal of rows) {\n        next[proposal.id] = current[proposal.id] ?? String(proposal.product.stock);\n      }\n      return next;\n    });\n    setSelectedImages((current) => {`,
`    setStockValues((current) => {\n      const next: Record<string, string> = {};\n      for (const proposal of rows) {\n        next[proposal.id] = current[proposal.id] ?? String(proposal.product.stock);\n      }\n      return next;\n    });\n    setVariantStockValues((current) => {\n      const next: Record<string, Record<string, string>> = {};\n      for (const proposal of rows) {\n        const variants = proposalVariants(proposal.product.variants);\n        if (!variants.length) continue;\n        const previous = current[proposal.id] || {};\n        next[proposal.id] = Object.fromEntries(\n          variants.map((variant) => [variant.id, previous[variant.id] ?? String(variant.stock)]),\n        );\n      }\n      return next;\n    });\n    setSelectedImages((current) => {`,
"инициализация остатков вариантов",
);

replaceOnce(
`  async function applyProposal(proposalId: string, mode: ApplyMode) {\n    const stock = Number(stockValues[proposalId] ?? "0");\n    if (!Number.isInteger(stock) || stock < 0) {\n      setMessage("Количество должно быть целым числом от 0 и выше.");\n      return;\n    }\n\n    setBusyKey(\`apply:\${proposalId}:\${mode}\`);`,
`  async function applyProposal(proposalId: string, mode: ApplyMode) {\n    const proposal = proposals.find((item) => item.id === proposalId);\n    const variants = proposalVariants(proposal?.product.variants);\n    let stock: number | undefined;\n    let variantStocks: Record<string, number> | undefined;\n\n    if (variants.length) {\n      variantStocks = {};\n      for (const variant of variants) {\n        const value = Number(variantStockValues[proposalId]?.[variant.id] ?? variant.stock);\n        if (!Number.isInteger(value) || value < 0) {\n          setMessage(\`Количество для варианта «\${variant.label}» должно быть целым числом от 0 и выше.\`);\n          return;\n        }\n        variantStocks[variant.id] = value;\n      }\n    } else {\n      stock = Number(stockValues[proposalId] ?? "0");\n      if (!Number.isInteger(stock) || stock < 0) {\n        setMessage("Количество должно быть целым числом от 0 и выше.");\n        return;\n      }\n    }\n\n    setBusyKey(\`apply:\${proposalId}:\${mode}\`);`,
"валидация остатков вариантов",
);

replaceOnce(
`          imageUrl: selectedImages[proposalId] || "",\n          stock,\n        }),`,
`          imageUrl: selectedImages[proposalId] || "",\n          stock,\n          variantStocks,\n        }),`,
"передача остатков вариантов",
);

replaceOnce(
`            const selectedImage = selectedImages[proposal.id] || "";\n            const isBusy = Boolean(busyKey?.includes(proposal.id));`,
`            const selectedImage = selectedImages[proposal.id] || "";\n            const isBusy = Boolean(busyKey?.includes(proposal.id));\n            const variants = proposalVariants(proposal.product.variants);`,
"variants в карточке предложения",
);

replaceOnce(
`                    <label className="block rounded-xl border p-3 text-sm">\n                      <span className="mb-1 block font-medium">Количество на складе</span>\n                      <input\n                        type="number"\n                        min={0}\n                        step={1}\n                        inputMode="numeric"\n                        className="w-full rounded-xl border px-3 py-2"\n                        value={stockValues[proposal.id] ?? String(proposal.product.stock)}\n                        onChange={(event) =>\n                          setStockValues((current) => ({\n                            ...current,\n                            [proposal.id]: event.target.value,\n                          }))\n                        }\n                      />\n                      <span className="mt-1 block text-xs text-gray-500">\n                        Значение сохранится вместе с одобрением предложения. Ноль означает «нет в наличии».\n                      </span>\n                    </label>`,
`                    {variants.length ? (\n                      <div className="rounded-xl border p-3 text-sm">\n                        <div className="mb-2 font-medium">Количество по вариантам</div>\n                        <div className="grid gap-2 sm:grid-cols-2">\n                          {variants.map((variant) => (\n                            <label key={variant.id} className="rounded-lg bg-gray-50 p-2">\n                              <span className="mb-1 block text-xs font-medium">\n                                {variant.label}\n                                {variant.sku ? \` · SKU \${variant.sku}\` : ""}\n                              </span>\n                              <input\n                                type="number"\n                                min={0}\n                                step={1}\n                                inputMode="numeric"\n                                className="w-full rounded-lg border bg-white px-3 py-2"\n                                value={variantStockValues[proposal.id]?.[variant.id] ?? String(variant.stock)}\n                                onChange={(event) =>\n                                  setVariantStockValues((current) => ({\n                                    ...current,\n                                    [proposal.id]: {\n                                      ...(current[proposal.id] || {}),\n                                      [variant.id]: event.target.value,\n                                    },\n                                  }))\n                                }\n                              />\n                              <span className="mt-1 block text-[11px] text-gray-500">\n                                {variant.price.toLocaleString("ru-RU")} ₸\n                              </span>\n                            </label>\n                          ))}\n                        </div>\n                        <span className="mt-2 block text-xs text-gray-500">\n                          Остаток хранится отдельно для каждой фасовки.\n                        </span>\n                      </div>\n                    ) : (\n                      <label className="block rounded-xl border p-3 text-sm">\n                        <span className="mb-1 block font-medium">Количество на складе</span>\n                        <input\n                          type="number"\n                          min={0}\n                          step={1}\n                          inputMode="numeric"\n                          className="w-full rounded-xl border px-3 py-2"\n                          value={stockValues[proposal.id] ?? String(proposal.product.stock)}\n                          onChange={(event) =>\n                            setStockValues((current) => ({\n                              ...current,\n                              [proposal.id]: event.target.value,\n                            }))\n                          }\n                        />\n                        <span className="mt-1 block text-xs text-gray-500">\n                          Значение сохранится вместе с одобрением предложения. Ноль означает «нет в наличии».\n                        </span>\n                      </label>\n                    )}`,
"поле количества",
);

fs.writeFileSync(path, text);
console.log("AdminEnrichmentClient обновлён для остатков вариантов");
