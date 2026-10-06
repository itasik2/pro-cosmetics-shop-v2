import { normalizeCatalogText } from "./catalogFilters";
import { hasMissingProductData } from "./productCopy";

const AZELAIC_SOURCE = "https://angiopharm.com/389-azelainovij-krem-dlya-chuvstvitelnoj-kozhi-50-ml";

// Verified 2026-10-06. Use only to replace the known incomplete imported copy.
// Complete/manual descriptions and other products retain their original text.
export function verifiedProductCopy(product: { name: string; description: string; brand?: { name: string } | null }) {
  const name = normalizeCatalogText(product.name);
  if (normalizeCatalogText(product.brand?.name) !== "angiopharm" ||
      !/^азелаиновый крем для чувствительной кожи(?: 10)?(?: (?:7|50) мл)?$/.test(name) ||
      !hasMissingProductData(product.description)) return null;
  return {
    sourceUrl: AZELAIC_SOURCE,
    description: `Крем Angiopharm с 10 % азелаиновой кислоты для ухода за чувствительной кожей. Увлажняющие компоненты и липиды помогают поддерживать защитный барьер кожи.

Для какой кожи
Для чувствительной кожи. При заболеваниях кожи схему ухода согласуйте со специалистом.

Преимущества
• помогает поддерживать увлажнённость кожи
• дополняет уход за неровным тоном
• содержит липиды для поддержки кожного барьера

Способ применения
Распределите крем мягкими вбивающими движениями по очищенной сухой коже лица, обходя зону вокруг глаз. Не растирайте. Днём используйте солнцезащитное средство SPF 30/50.

Важно
Средство предназначено для наружного применения. При непереносимости компонентов не используйте его. Производитель предупреждает, что крем может скатываться из-за водонерастворимой азелаиновой кислоты. Сверяйтесь с инструкцией на своей упаковке.`,
  };
}
