export function brandNameToSlug(input: string) {
  return input
    .toLowerCase()
    .trim()
    .replace(/[_\s]+/g, "-")
    .replace(/[^a-z0-9а-яё-]+/gi, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}
