import type {Mapping} from "./import-types";

export function isJeudermPriceList(fileName:string,format:string,headers:string[]):boolean {
  return format==="PDF" && /jeu\s*d[eé]rm|жеудерм/i.test(fileName) &&
    headers.includes("Цена 1") && headers.includes("Цена 2");
}

// Apply the confirmed supplier rule only to a new mapping. A saved profile,
// history snapshot or manual column selection always takes precedence.
export function defaultImportMapping(fileName:string,format:string,headers:string[],mapping:Mapping):Mapping {
  if(!isJeudermPriceList(fileName,format,headers))return mapping;
  return {...mapping,purchasePrice:"Цена 1",price:"Цена 2"};
}
