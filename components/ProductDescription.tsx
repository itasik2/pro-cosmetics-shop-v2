import { customerProductCopy, hasMissingProductData } from "@/lib/productCopy";
import type { ReactNode } from "react";
import type { SiteLocale } from "@/lib/i18n";
import {
  ALL_PRODUCT_SECTION_HEADINGS,
  canonicalProductSectionHeading,
  localizedProductSectionHeading,
  stripProductSectionMarkdown,
} from "@/lib/productSectionHeadings";

const PRIVATE_SECTION_TITLES = new Set(["Состав и активные компоненты"]);

// Product content may contain headings saved in Russian or in the user's
// selected language. The renderer recognizes all of them, including legacy
// Russian translations saved before localization was fixed.
const SECTION_PATTERN = ALL_PRODUCT_SECTION_HEADINGS
  .map((title) => title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  .join("|");

export function normalizeDescriptionLayout(value: string) {
  let text = stripProductSectionMarkdown(customerProductCopy(value)
    .replace(/\r\n?/g, "\n")
    .trim());

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
  locale = "ru",
}: {
  description: string;
  locale?: SiteLocale;
}) {
  const blocks = normalizeDescriptionLayout(description)
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  if (!blocks.length) return null;

  const visibleBlocks = blocks.flatMap((block, blockIndex) => {
    const lines = block
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const heading = canonicalProductSectionHeading(lines[0]);
    if (heading && PRIVATE_SECTION_TITLES.has(heading)) return [];

    const rawContentLines = heading ? lines.slice(1) : lines;
    const contentLines = rawContentLines.filter((line) => !hasMissingProductData(line));
    if (heading === "Способ применения" && !contentLines.length) {
      contentLines.push(locale === "kk"
        ? "Қолдану тәсілін сатып алар алдында дүкеннен нақтылаңыз. Пайдаланғанда қаптамадағы нұсқаулықты ұстаныңыз."
        : locale === "en"
          ? "Please confirm how to use this product before purchasing. Follow the instructions on the packaging."
          : "Уточните способ применения перед покупкой через кнопку «Спросить о товаре». При использовании следуйте инструкции на упаковке.");
    }
    if (!contentLines.length) return [];

    return [{ blockIndex, heading, contentLines }];
  });

  if (!visibleBlocks.length) return null;

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 text-gray-700 shadow-sm sm:p-6">
      <div className="space-y-5">
        {visibleBlocks.map(({ blockIndex, heading, contentLines }, visibleIndex) => (
          <section
            key={`${heading || "description"}-${blockIndex}`}
            className={visibleIndex > 0 ? "border-t border-gray-100 pt-5" : undefined}
          >
            {heading && (
              <h2 className="mb-2 text-base font-semibold text-gray-950">
                {localizedProductSectionHeading(heading, locale) || heading}
              </h2>
            )}

            <div
              className={
                "space-y-2 leading-7 " +
                (visibleIndex === 0 && !heading
                  ? "text-[17px] text-gray-800"
                  : "text-[15px]")
              }
            >
              {descriptionContent(contentLines)}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
