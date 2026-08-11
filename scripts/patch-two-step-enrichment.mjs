import fs from "node:fs";

const path = "app/admin/(private)/enrichment/AdminEnrichmentClient.tsx";
let text = fs.readFileSync(path, "utf8");

function replaceOnce(from, to, label) {
  if (text.includes(to)) return;
  if (!text.includes(from)) throw new Error(`Не найден участок: ${label}`);
  text = text.replace(from, to);
}

replaceOnce(
`    description: string;\n    isPublished: boolean;`,
`    description: string;\n    stock: number;\n    isPublished: boolean;`,
"тип stock товара предложения",
);

replaceOnce(
`  const [selectedImages, setSelectedImages] = useState<Record<string, string>>({});\n  const [sourceForm, setSourceForm] = useState<SourceForm>(emptySourceForm);`,
`  const [selectedImages, setSelectedImages] = useState<Record<string, string>>({});\n  const [stockValues, setStockValues] = useState<Record<string, string>>({});\n  const [sourceForm, setSourceForm] = useState<SourceForm>(emptySourceForm);`,
"state количества",
);

replaceOnce(
`    const rows = (await readResponse(response)) as Proposal[];\n    setProposals(rows);\n    setSelectedImages((current) => {`,
`    const rows = (await readResponse(response)) as Proposal[];\n    setProposals(rows);\n    setStockValues((current) => {\n      const next: Record<string, string> = {};\n      for (const proposal of rows) {\n        next[proposal.id] = current[proposal.id] ?? String(proposal.product.stock);\n      }\n      return next;\n    });\n    setSelectedImages((current) => {`,
"инициализация количества",
);

replaceOnce(
`  async function applyProposal(proposalId: string, mode: ApplyMode) {\n    setBusyKey(\`apply:\${proposalId}:\${mode}\`);\n    setMessage(null);\n    try {`,
`  async function applyProposal(proposalId: string, mode: ApplyMode) {\n    const stock = Number(stockValues[proposalId] ?? "0");\n    if (!Number.isInteger(stock) || stock < 0) {\n      setMessage("Количество должно быть целым числом от 0 и выше.");\n      return;\n    }\n\n    setBusyKey(\`apply:\${proposalId}:\${mode}\`);\n    setMessage(null);\n    try {`,
"проверка количества",
);

replaceOnce(
`        body: JSON.stringify({\n          mode,\n          imageUrl: selectedImages[proposalId] || "",\n        }),`,
`        body: JSON.stringify({\n          mode,\n          imageUrl: selectedImages[proposalId] || "",\n          stock,\n        }),`,
"передача количества",
);

replaceOnce(
`      setMessage(\n        mode === "ALL"\n          ? "Описание и изображение применены. Товар не опубликован автоматически."\n          : mode === "DESCRIPTION"\n            ? "Описание применено."\n            : "Изображение перенесено в Cloudinary и применено.",\n      );`,
`      setMessage(\n        mode === "ALL"\n          ? "Описание, фото и количество применены. Товар добавлен в черновики для публикации."\n          : mode === "DESCRIPTION"\n            ? "Описание и количество сохранены. Предложение остаётся на проверке."\n            : "Фото и количество сохранены. Предложение остаётся на проверке.",\n      );`,
"сообщение применения",
);

replaceOnce(
`                    <JsonBlock label="Извлечённые факты" value={proposal.facts} />`,
`                    <label className="block rounded-xl border p-3 text-sm">\n                      <span className="mb-1 block font-medium">Количество на складе</span>\n                      <input\n                        type="number"\n                        min={0}\n                        step={1}\n                        inputMode="numeric"\n                        className="w-full rounded-xl border px-3 py-2"\n                        value={stockValues[proposal.id] ?? String(proposal.product.stock)}\n                        onChange={(event) =>\n                          setStockValues((current) => ({\n                            ...current,\n                            [proposal.id]: event.target.value,\n                          }))\n                        }\n                      />\n                      <span className="mt-1 block text-xs text-gray-500">\n                        Значение сохранится вместе с одобрением предложения. Ноль означает «нет в наличии».\n                      </span>\n                    </label>\n\n                    <JsonBlock label="Извлечённые факты" value={proposal.facts} />`,
"поле количества в предложении",
);

fs.writeFileSync(path, text);
console.log("AdminEnrichmentClient обновлён");
