/** Explicit packaging text only. Never calculate a bundle's weight from its name. */
export function supplierPackage(raw: string) {
  const value = raw.trim().replace(/^(?:саше|банка|дой[-\s]?пак|флакон|туба|бутылка|коробка|набор)\s*,?\s*/iu, "");
  const match = value.match(/^(\d+(?:[.,]\d+)?)\s*(мл|ml|л|l|г|гр|g|кг|kg|шт|уп|упак|рулон)\.?$/i);
  if (!match) return null;
  const units: Record<string,string> = { "мл":"ml",ml:"ml","л":"l",l:"l","г":"g","гр":"g",g:"g","кг":"kg",kg:"kg","шт":"pcs","уп":"pack","упак":"pack","рулон":"roll" };
  const amount = Number(match[1].replace(",","."));
  return amount>0?{value:amount,unit:units[match[2].toLowerCase()],raw}:null;
}
export function packageIdentity(raw: string): string | null {
  const pack=supplierPackage(raw);
  if(!pack)return null;
  const unit=pack.unit==="kg"?"g":pack.unit==="l"?"ml":pack.unit;
  return `${pack.value*(pack.unit==="kg"||pack.unit==="l"?1000:1)}:${unit}`;
}
export function titleWithoutPackage(title: string, rawPackage: string): string {
  const expected=packageIdentity(rawPackage);
  if(!expected)return title;
  const suffix=title.match(/(?:\s*[,;/–—(\-]\s*|\s+)(\d+(?:[.,]\d+)?\s*(?:мл|ml|кг|kg|гр|г|g|л|l|шт|упак|уп|рулон)\.?)\s*\)?\s*$/iu);
  if(!suffix||packageIdentity(suffix[1])!==expected)return title;
  const before=title.slice(0,suffix.index).trim();
  if(!before||/[+×]/.test(before))return title;
  return before;
}
