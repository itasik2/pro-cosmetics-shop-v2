import { readFile, writeFile } from "node:fs/promises";

function replaceOnce(content, search, replacement, label) {
  if (!content.includes(search)) {
    throw new Error(`Не найден участок для замены: ${label}`);
  }
  const updated = content.replace(search, replacement);
  if (updated === content) throw new Error(`Замена не выполнена: ${label}`);
  return updated;
}

const clientPath = "app/admin/(private)/enrichment/AdminEnrichmentClient.tsx";
let client = await readFile(clientPath, "utf8");

const statusBadgeBlock = `function StatusBadge({ value }: { value: string }) {
  return (
    <span className={\`inline-flex rounded-full border px-2 py-0.5 text-[11px] \${statusClass(value)}\`}>
      {value}
    </span>
  );
}
`;

const selectableImageBlock = `${statusBadgeBlock}
type ImageStatus = "loading" | "loaded" | "error";

function SelectableImage({
  src,
  selected,
  proposalId,
  index,
  onSelect,
}: {
  src: string;
  selected: boolean;
  proposalId: string;
  index: number;
  onSelect: () => void;
}) {
  const [status, setStatus] = useState<ImageStatus>("loading");

  useEffect(() => {
    setStatus("loading");
    const timer = window.setTimeout(() => {
      setStatus((current) => (current === "loading" ? "error" : current));
    }, 12_000);
    return () => window.clearTimeout(timer);
  }, [src]);

  const canSelect = status === "loaded";

  return (
    <label
      className={\`relative rounded-xl border p-2 transition \${
        selected
          ? "border-black ring-2 ring-black"
          : canSelect
            ? "cursor-pointer hover:border-gray-500"
            : "cursor-not-allowed border-gray-200"
      }\`}
    >
      <input
        type="radio"
        className="sr-only"
        name={\`proposal-image-\${proposalId}\`}
        checked={selected}
        disabled={!canSelect}
        onChange={onSelect}
      />

      <div className="relative aspect-square overflow-hidden rounded-lg bg-gray-50">
        {status === "loading" && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-gray-50 text-xs text-gray-500">
            <span className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-black" />
            Загрузка фото…
          </div>
        )}

        {status === "error" && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-gray-50 px-3 text-center text-xs text-red-700">
            Фото недоступно
          </div>
        )}

        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={\`Вариант изображения \${index + 1}\`}
          className={\`h-full w-full object-contain transition-opacity \${
            status === "loaded" ? "opacity-100" : "opacity-0"
          }\`}
          loading="eager"
          onLoad={() => setStatus("loaded")}
          onError={() => setStatus("error")}
        />
      </div>

      <div
        className={\`mt-2 rounded-lg px-2 py-1 text-center text-xs font-medium \${
          selected
            ? "bg-black text-white"
            : canSelect
              ? "bg-gray-100 text-gray-800"
              : "bg-gray-50 text-gray-400"
        }\`}
      >
        {selected
          ? "Выбрано ✓"
          : status === "loaded"
            ? "Выбрать фото"
            : status === "error"
              ? "Недоступно"
              : "Загрузка…"}
      </div>
    </label>
  );
}
`;

client = replaceOnce(
  client,
  statusBadgeBlock,
  selectableImageBlock,
  "компонент выбора изображения",
);

client = replaceOnce(
  client,
  `    setSelectedImages((current) => {
      const next = { ...current };
      for (const proposal of rows) {
        const images = stringArray(proposal.images);
        if (!next[proposal.id] && images[0]) next[proposal.id] = images[0];
      }
      return next;
    });`,
  `    setSelectedImages((current) => {
      const activeProposalIds = new Set(rows.map((proposal) => proposal.id));
      return Object.fromEntries(
        Object.entries(current).filter(([proposalId]) => activeProposalIds.has(proposalId)),
      );
    });`,
  "отмена автоматического выбора первого изображения",
);

client = replaceOnce(
  client,
  `            const selectedImage = selectedImages[proposal.id] || images[0] || "";`,
  `            const selectedImage = selectedImages[proposal.id] || "";`,
  "явный выбор изображения",
);

client = replaceOnce(
  client,
  `                          {images.map((image) => (
                            <label
                              key={image}
                              className={\`cursor-pointer rounded-xl border p-2 \${
                                selectedImage === image ? "ring-2 ring-black" : ""
                              }\`}
                            >
                              <input
                                type="radio"
                                className="sr-only"
                                name={\`proposal-image-\${proposal.id}\`}
                                checked={selectedImage === image}
                                onChange={() =>
                                  setSelectedImages((current) => ({
                                    ...current,
                                    [proposal.id]: image,
                                  }))
                                }
                              />
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={image}
                                alt=""
                                className="aspect-square w-full rounded-lg bg-gray-50 object-contain"
                                loading="lazy"
                              />
                            </label>
                          ))}`,
  `                          {images.map((image, index) => (
                            <SelectableImage
                              key={image}
                              src={image}
                              index={index}
                              proposalId={proposal.id}
                              selected={selectedImage === image}
                              onSelect={() =>
                                setSelectedImages((current) => ({
                                  ...current,
                                  [proposal.id]: image,
                                }))
                              }
                            />
                          ))}`,
  "сетка вариантов изображений",
);

client = replaceOnce(
  client,
  `                        </div>
                      ) : (
                        <div className="text-sm text-gray-500">Изображения не найдены.</div>
                      )}
                    </div>`,
  `                        </div>
                      ) : (
                        <div className="text-sm text-gray-500">Изображения не найдены.</div>
                      )}
                      {images.length > 0 && (
                        <div className="mt-2 text-xs text-gray-600">
                          {selectedImage
                            ? "Выбранное фото будет скопировано в Cloudinary."
                            : "Нажмите «Выбрать фото» под подходящим изображением."}
                        </div>
                      )}
                    </div>`,
  "подсказка по выбору изображения",
);

client = replaceOnce(
  client,
  `                    className="rounded-xl bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
                    disabled={isBusy}
                    onClick={() => void applyProposal(proposal.id, "ALL")}`,
  `                    className="rounded-xl bg-black px-4 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={isBusy || !selectedImage}
                    title={!selectedImage ? "Сначала выберите доступное фото" : undefined}
                    onClick={() => void applyProposal(proposal.id, "ALL")}`,
  "блокировка применения всего без фото",
);

client = replaceOnce(
  client,
  `                    disabled={isBusy || images.length === 0}
                    onClick={() => void applyProposal(proposal.id, "IMAGE")}`,
  `                    disabled={isBusy || !selectedImage}
                    title={!selectedImage ? "Сначала выберите доступное фото" : undefined}
                    onClick={() => void applyProposal(proposal.id, "IMAGE")}`,
  "блокировка применения фото без выбора",
);

await writeFile(clientPath, client);

const extractorPath = "lib/enrichment/extractProduct.ts";
let extractor = await readFile(extractorPath, "utf8");

extractor = replaceOnce(
  extractor,
  `      const raw =
        $(element).attr("src") ||
        $(element).attr("data-src") ||
        $(element).attr("data-large-img-url") ||
        $(element).attr("href");
      const url = asUrl(raw, baseUrl);
      if (url) images.push(url);`,
  `      const raw =
        $(element).attr("src") ||
        $(element).attr("data-src") ||
        $(element).attr("data-large-img-url") ||
        $(element).attr("href");
      const elementHint = [
        raw,
        $(element).attr("alt"),
        $(element).attr("title"),
        $(element).attr("class"),
        $(element).attr("id"),
        $(element).attr("aria-label"),
      ]
        .filter(Boolean)
        .join(" ");
      if (!isLikelyProductImage(elementHint)) return;
      const url = asUrl(raw, baseUrl);
      if (url && isLikelyProductImage(url)) images.push(url);`,
  "фильтр элементов интерфейса при извлечении изображений",
);

extractor = replaceOnce(
  extractor,
  `function isLikelyProductImage(url: string) {
  return !/(?:logo|icon|sprite|payment|instagram|whatsapp|facebook|telegram|favicon)/i.test(
    url,
  );
}`,
  `function isLikelyProductImage(value: string) {
  const normalized = value.toLocaleLowerCase("ru-RU");
  if (!normalized) return false;
  if (/\\.svg(?:$|[?#])/i.test(normalized)) return false;

  return !/(?:logo|icon|sprite|payment|favicon|avatar|badge|banner|button|widget|social|share|instagram|whatsapp|facebook|telegram|yandex|passport|login|signin|sign-in|auth|oauth|captcha)/i.test(
    normalized,
  );
}`,
  "расширенный фильтр служебных изображений",
);

await writeFile(extractorPath, extractor);
console.log("Патч выбора изображений применён.");
