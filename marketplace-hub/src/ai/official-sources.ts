// The same known brand sites used by ProCosmetics supplier source defaults.
// These are discovery hints, not a grant to publish their content automatically.
export function knownOfficialDomains(brand: string | undefined) {
  const hint = String(brand || "").toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е").replace(/[^a-zа-я0-9]+/g, "");
  if (hint.includes("angiopharm") || hint.includes("ангиофарм"))
    return ["angiopharm.kz", "angiopharm.com"];
  if (hint.includes("mesaltera") || hint.includes("мезальтера"))
    return ["thoscane.ru"];
  return [];
}
