import type { ReactNode } from "react";

const SECTION_TITLES = [
  "Для какой кожи",
  "Для каких задач",
  "Преимущества",
  "Почему удобно",
  "Способ применения",
  "Состав и активные компоненты",
  "Важно",
] as const;

const SECTION_TITLE_SET = new Set<string>(SECTION_TITLES);
const SECTION_PATTERN = SECTION_TITLES.join("|");

export function normalizeDescriptionLayout(value: string) {
  let text = String(value || "")
    .replace(/\r\n?/g, "\n")
    .trim();

  if (!text) return "";

  text = text.replace(
    new RegExp(`\\s+(${SECTION_PATTERN})\\s+(?=\\S)`, "g"),
    "\n\n$1\n",
  );
  text = text.replace(new RegExp(`^(${SECTION_PATTERN})\\s+(?=\\S)`), "$1\n");

  return text.replace(/\n{3,}/g, "\n\n").trim();
}

function descriptionContent(lines: string[]): ReactNode {
  const bullets = lines.filter((line) => /^[•-]\s*/.test(line));
  const paragraphs = lines.filter((line) => !/^[•-]\s*/.test(line));

  return (
    <>
      {paragraphs.map((line, index) => (
        <p key={`paragraph-${index}`}>{line}</p>
      ))}

      {bullets.length > 0 && (
        <ul className="list-disc space-y-1.5 pl-5 marker:text-gray-400">
          {bullets.map((line, index) => (
            <li key={`bullet-${index}`}>{line.replace(/^[•-]\s*/, "")}</li>
          ))}
        </ul>
      )}
    </>
  );
}

export default function ProductDescription({
  description,
}: {
  description: string;
}) {
  const blocks = normalizeDescriptionLayout(description)
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  if (!blocks.length) return null;

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 text-gray-700 shadow-sm sm:p-6">
      <div className="space-y-5">
        {blocks.map((block, blockIndex) => {
          const lines = block
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean);
          const heading = SECTION_TITLE_SET.has(lines[0]) ? lines[0] : null;
          const contentLines = heading ? lines.slice(1) : lines;

          if (!contentLines.length) return null;

          return (
            <section
              key={`${heading || "description"}-${blockIndex}`}
              className={
                blockIndex > 0 ? "border-t border-gray-100 pt-5" : undefined
              }
            >
              {heading && (
                <h2 className="mb-2 text-base font-semibold text-gray-950">
                  {heading}
                </h2>
              )}

              <div
                className={
                  "space-y-2 leading-7 " +
                  (blockIndex === 0 && !heading
                    ? "text-[17px] text-gray-800"
                    : "text-[15px]")
                }
              >
                {descriptionContent(contentLines)}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
