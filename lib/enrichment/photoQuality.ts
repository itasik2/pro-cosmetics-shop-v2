export function isUsablePhoto(value: unknown): value is string {
  const url = typeof value === "string" ? value.trim() : "";
  return Boolean(url) && !/^\/seed\//i.test(url) && isProductPhoto(url);
}

export function isProductPhoto(value: string) {
  // Some shops store actual product photos in /icons/. Inspect the file name,
  // not those directory names, while retaining the surrounding alt/class hints.
  const hint = value.toLowerCase().replace(/https?:\/\/[^\s"'<>]+/g, (raw) => {
    try {
      return new URL(raw).pathname.split("/").pop() || "";
    } catch {
      return raw;
    }
  });
  if (/\.(svg|gif)(?:$|[?#\s])/i.test(hint)) return false;
  return (
    !/(?:^|[^a-zа-я0-9])(?:logo|logotype|stub|placeholder|no[-_]?image|no[-_]?photo|default[-_]?image|loader|loading|spinner|sprite|favicon|avatar|banner|social|payment|captcha)(?:[^a-zа-я0-9]|$)/i.test(
      hint,
    ) &&
    !/(?:логотип|изображение отсутствует|нет фото|ajax[._-]?loader|sign-in|oauth)/iu.test(
      hint,
    )
  );
}
