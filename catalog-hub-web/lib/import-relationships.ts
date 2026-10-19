import type { ImportItem } from "./import-parser";

export type Relationship = { kind: "VARIANT" | "DUPLICATE"; indices: number[]; reason: string };

const suffix = /(?:\s*[,;/\-–—(]\s*)?(\d+(?:[.,]\d+)?)\s*(мл|ml|л|l|г|гр|g|кг|kg|шт|упак|рулон)\.?\s*\)?\s*$/iu;
function normalize(value: string) {
  return value.toLocaleLowerCase("ru-RU").replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}
function volume(item: ImportItem) {
  const match = (item.volume?.trim() || item.title.match(suffix)?.[0] || "").match(/(\d+(?:[.,]\d+)?)\s*(мл|ml|л|l|г|гр|g|кг|kg|шт|упак|рулон)/iu);
  if (!match) return null;
  const factor: Record<string,[string,number]> = { мл:["ml",1],ml:["ml",1],л:["ml",1000],l:["ml",1000],
    г:["g",1],гр:["g",1],g:["g",1],кг:["g",1000],kg:["g",1000],шт:["pcs",1],упак:["pack",1],рулон:["roll",1] };
  const [unit,multiplier] = factor[match[2].toLowerCase()];
  return `${Number(match[1].replace(",","."))*multiplier}:${unit}`;
}

export function suggestRelationships(items: ImportItem[]): Array<Relationship|null> {
  const groups = new Map<string,Array<{index:number;volume:string}>>();
  items.forEach((item,index) => {
    const size = volume(item);
    const name = normalize(item.title.replace(suffix,""));
    const brand = normalize(item.brand || "");
    if (!size || !brand || !name) return;
    const key = brand + "|" + name;
    groups.set(key,[...(groups.get(key) || []),{index,volume:size}]);
  });
  const result: Array<Relationship|null> = items.map(() => null);
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    for (const entry of group) {
      const peers = group.filter(other => other.index !== entry.index);
      const duplicates = peers.filter(other => other.volume === entry.volume);
      result[entry.index] = duplicates.length ? {
        kind:"DUPLICATE", indices:duplicates.map(other => other.index),
        reason:"Одинаковое название, бренд и фасовка. Проверьте SKU перед объединением.",
      } : { kind:"VARIANT", indices:peers.map(other => other.index),
        reason:"Одинаковое название и бренд, разные фасовки. Проверьте варианты вручную.",
      };
    }
  }
  return result;
}
