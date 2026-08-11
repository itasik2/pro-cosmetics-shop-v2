import { readFile, writeFile } from "node:fs/promises";

const path = "app/admin/(private)/enrichment/AdminEnrichmentClient.tsx";
let source = await readFile(path, "utf8");

function replaceOnce(search, replacement, label) {
  const index = source.indexOf(search);
  if (index < 0) throw new Error(`Patch target not found: ${label}`);
  if (source.indexOf(search, index + search.length) >= 0) {
    throw new Error(`Patch target is not unique: ${label}`);
  }
  source = source.slice(0, index) + replacement + source.slice(index + search.length);
}

replaceOnce(
`    description: string;\n    isPublished: boolean;\n`,
`    description: string;\n    stock: number;\n    isPublished: boolean;\n`,
"proposal product stock type",
);

replaceOnce(
`  const [selectedImages, setSelectedImages] = useState<Record<string, string>>({});\n`,
`  const [selectedImages, setSelectedImages] = useState<Record<string, string>>({});\n  const [stockValues, setStockValues] = useState<Record<string, string>>({});\n`,
"stock state",
);

replaceOnce(
`    setSelectedImages((current) => {\n      const activeProposalIds = new Set(rows.map((proposal) => proposal.id));\n      return Object.fromEntries(\n        Object.entries(current).filter(([proposalId]) => activeProposalIds.has(proposalId)),\n      );\n    });\n`,
`    setSelectedImages((current) => {\n      const activeProposalIds = new Set(rows.map((proposal) => proposal.id));\n      return Object.fromEntries(\n        Object.entries(current).filter(([proposalId]) => activeProposalIds.has(proposalId)),\n      );\n    });\n    setStockValues((current) => {\n      const next: Record<string, string> = {};\n      for (const proposal of rows) {\n        next[proposal.id] = current[proposal.id] ?? String(proposal.product.stock);\n      }\n      return next;\n    });\n`,
"load proposal stock values",
);

replaceOnce(
`  async function applyProposal(proposalId: string, mode: ApplyMode) {\n    setBusyKey(\`apply:\${proposalId}:\${mode}\`);\n    setMessage(null);\n    try {\n      const response = await fetch(\`/api/admin/enrichment/proposals/\${proposalId}/apply\`, {\n        method: "POST",\n        headers: { "Content-Type": "application/json" },\n        body: JSON.stringify({\n          mode,\n          imageUrl: selectedImages[proposalId] || "",\n        }),\n      });\n      await readResponse(response);\n      setMessage(\n        mode === "ALL"\n          ? "Описание и изображение применены. Товар не опубликован автоматически."\n          : mode === "DESCRIPTION"\n            ? "Описание применено."\n            : "Изображение перенесено в Cloudinary и применено.",\n      );\n      await Promise.all([loadProducts(), loadProposals()]);\n    } catch (error) {\n      setMessage(\`Не удалось применить предложение: \${error instanceof Error ? error.message : String(error)}\`);\n    } finally {\n      setBusyKey(null);\n    }\n  }\n`,
`  async function applyProposal(proposalId: string, mode: ApplyMode) {\n    const rawStock = stockValues[proposalId] ?? "0";\n    const stock = Number(rawStock);\n    if (!Number.isInteger(stock) || stock < 0) {\n      setMessage("Количество должно быть целым числом от 0 и выше.");\n      return;\n    }\n\n    setBusyKey(\`apply:\${proposalId}:\${mode}\`);\n    setMessage(null);\n    try {\n      const response = await fetch(\`/api/admin/enrichment/proposals/\${proposalId}/apply\`, {\n        method: "POST",\n        headers: { "Content-Type": "application/json" },\n        body: JSON.stringify({\n          mode,\n          imageUrl: selectedImages[proposalId] || "",\n          stock,\n        }),\n      });\n      await readResponse(response);\n      setMessage(\n        mode === "ALL"\n          ? \`Описание, фото и количество (\${stock}) применены. Товар добавлен в очередь черновиков.\`\n          : mode === "DESCRIPTION"\n            ? \`Описание и количество (\${stock}) применены.\`\n            : \`Изображение и количество (\${stock}) применены.\`,\n      );\n      window.dispatchEvent(new Event("products-changed"));\n      await Promise.all([loadProducts(), loadProposals()]);\n    } catch (error) {\n      setMessage(\`Не удалось применить предложение: \${error instanceof Error ? error.message : String(error)}\`);\n    } finally {\n      setBusyKey(null);\n    }\n  }\n`,
"apply proposal with stock",
);

replaceOnce(
`            const images = stringArray(proposal.images);\n            const selectedImage = selectedImages[proposal.id] || "";\n            const isBusy = Boolean(busyKey?.includes(proposal.id));\n`,
`            const images = stringArray(proposal.images);\n            const selectedImage = selectedImages[proposal.id] || "";\n            const stockValue = stockValues[proposal.id] ?? String(proposal.product.stock);\n            const isBusy = Boolean(busyKey?.includes(proposal.id));\n`,
"proposal stock render value",
);

replaceOnce(
`                    <JsonBlock label="Извлечённые факты" value={proposal.facts} />\n`,
`                    <label className="block rounded-xl border bg-gray-50 p-3 text-sm">\n                      <span className="mb-1 block font-medium">Количество на складе</span>\n                      <input\n                        type="number"\n                        min={0}\n                        step={1}\n                        inputMode="numeric"\n                        className="w-full rounded-xl border bg-white px-3 py-2"\n                        value={stockValue}\n                        onChange={(event) =>\n                          setStockValues((current) => ({\n                            ...current,\n                            [proposal.id]: event.target.value,\n                          }))\n                        }\n                      />\n                      <span className="mt-1 block text-xs text-gray-500">\n                        Количество сохранится одновременно с одобрением предложения.\n                      </span>\n                    </label>\n\n                    <JsonBlock label="Извлечённые факты" value={proposal.facts} />\n`,
"proposal stock input",
);

await writeFile(path, source);
console.log("Patched", path);
