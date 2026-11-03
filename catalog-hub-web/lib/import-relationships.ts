import type { ImportItem } from "./import-parser";
import {packageIdentity,titleWithoutPackage} from "./supplier-package";

export type Relationship = { kind: "VARIANT" | "DUPLICATE"; indices: number[]; reason: string; totalPeers:number };

const suffix = /(?:\s*[,;/\-–—(]\s*)?(\d+(?:[.,]\d+)?)\s*(мл|ml|л|l|г|гр|g|кг|kg|шт|упак|рулон)\.?\s*\)?\s*$/iu;
function normalize(value: string) {
  return value.toLocaleLowerCase("ru-RU").replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}
function volume(item: ImportItem) {
  return packageIdentity(item.volume?.trim() || item.title.match(suffix)?.[0]?.replace(/^[\s(,;/–—-]+/u,"").replace(/\)\s*$/,"") || "");
}

export function suggestRelationships(items: ImportItem[]): Array<Relationship|null> {
  const groups = new Map<string,Array<{index:number;volume:string}>>();
  items.forEach((item,index) => {
    const size = volume(item);
    const name = normalize(item.volume?titleWithoutPackage(item.title,item.volume):item.title.replace(suffix,""));
    const brand = normalize(item.brand || "");
    if (!size || !brand || !name) return;
    const key = brand + "|" + name;
    const group=groups.get(key)||[];
    group.push({index,volume:size});groups.set(key,group);
  });
  const result: Array<Relationship|null> = items.map(() => null);
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const sizes=new Map<string,typeof group>();
    for(const entry of group){const size=sizes.get(entry.volume)||[];size.push(entry);sizes.set(entry.volume,size);}
    for (const entry of group) {
      const duplicates = sizes.get(entry.volume)!;
      const peers=duplicates.length>1?duplicates:group;
      const indices:number[]=[];
      for(const other of peers){if(other.index!==entry.index)indices.push(other.index);if(indices.length===20)break;}
      result[entry.index] = duplicates.length>1 ? {
        kind:"DUPLICATE", indices,totalPeers:duplicates.length-1,
        reason:"Одинаковое название, бренд и фасовка. Проверьте SKU перед объединением.",
      } : { kind:"VARIANT", indices,totalPeers:group.length-1,
        reason:"Одинаковое название и бренд, разные фасовки. Проверьте варианты вручную.",
      };
    }
  }
  return result;
}
