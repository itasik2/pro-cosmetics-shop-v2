// lib/cartSelection.ts
const KEY = "cart_selected";

function dispatchSync() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event("storage-sync"));
}

export function getSelectedKeys(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? (JSON.parse(raw) as string[]) : [];
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string" && x.length > 0) : [];
  } catch {
    return [];
  }
}

export function setSelectedKeys(keys: string[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(Array.from(new Set(keys))));
  dispatchSync();
}
