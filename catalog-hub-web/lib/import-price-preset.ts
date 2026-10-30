import type {Mapping} from "./import-types";

export function isJeudermPriceList(fileName:string,format:string,headers:string[]):boolean {
  return format==="PDF" && /jeu\s*d[eé]rm|жеудерм/i.test(fileName) &&
    headers.includes("Цена 1") && headers.includes("Цена 2");
}

// Apply the confirmed supplier rule only to a new mapping. A saved profile,
// history snapshot or manual column selection always takes precedence.
export function defaultImportMapping(fileName:string,format:string,headers:string[],mapping:Mapping):Mapping {
  if(!isJeudermPriceList(fileName,format,headers))return mapping;
  // Only supply unselected fields. Never overwrite a saved or manual choice,
  // and never map two price roles to the same source column.
  const result:Mapping={...mapping};
  const used=new Set(Object.values(result).filter(Boolean));
  if(!("purchasePrice" in mapping)&&!used.has("Цена 1")){
    result.purchasePrice="Цена 1";used.add("Цена 1");
  }
  if(!("price" in mapping)&&!used.has("Цена 2")){
    result.price="Цена 2";
  }
  return result;
}
