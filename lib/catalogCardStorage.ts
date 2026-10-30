import { normalizeCartItems } from "./cartStorage";

type Listener = () => void;
const favoriteListeners = new Set<Listener>();
const cartListeners = new Set<Listener>();
let attached = false;
let favoriteRaw: string | null | undefined;
let cartRaw: string | null | undefined;
let favoriteIds = new Set<string>();
let cartQuantities = new Map<string, number>();

function storageValue(key: string) {
  if (typeof window === "undefined") return null;
  try { return window.localStorage.getItem(key); } catch { return null; }
}

function parseFavoriteIds(raw: string | null) {
  try {
    const value: unknown = JSON.parse(raw || "[]");
    return new Set(Array.isArray(value) ? value.map(String).filter(Boolean) : []);
  } catch { return new Set<string>(); }
}

export function readFavoriteIds() {
  return parseFavoriteIds(storageValue("favorites"));
}

function refreshFavorites() {
  const next = storageValue("favorites");
  if (next === favoriteRaw) return false;
  favoriteRaw = next;
  favoriteIds = parseFavoriteIds(next);
  return true;
}

function refreshCart() {
  const next = storageValue("cart");
  if (next === cartRaw) return false;
  cartRaw = next;
  try {
    cartQuantities = new Map(normalizeCartItems(JSON.parse(next || "[]")).map(item => [item.id, item.qty]));
  } catch { cartQuantities = new Map(); }
  return true;
}

export function isCardFavorite(productId: string) {
  if (!attached || favoriteRaw === undefined) refreshFavorites();
  return favoriteIds.has(productId);
}

export function cardCartQty(cartKey: string) {
  if (!attached || cartRaw === undefined) refreshCart();
  return cartQuantities.get(cartKey) || 0;
}

function notifyFavorites() {
  if (refreshFavorites()) favoriteListeners.forEach(listener => listener());
}

function notifyCart() {
  if (refreshCart()) cartListeners.forEach(listener => listener());
}

function onStorage(event: StorageEvent) {
  if (event.key === null || event.key === "favorites") notifyFavorites();
  if (event.key === null || event.key === "cart") notifyCart();
}

function onSync() {
  notifyFavorites();
  notifyCart();
}

function attach() {
  if (attached || typeof window === "undefined") return;
  window.addEventListener("storage", onStorage);
  window.addEventListener("storage-sync", onSync);
  window.addEventListener("favorites:changed", notifyFavorites);
  attached = true;
  // Catch a change made between the first render and React's subscription.
  notifyFavorites();
  notifyCart();
}

function detachIfUnused() {
  if (!attached || favoriteListeners.size || cartListeners.size) return;
  window.removeEventListener("storage", onStorage);
  window.removeEventListener("storage-sync", onSync);
  window.removeEventListener("favorites:changed", notifyFavorites);
  attached = false;
  // A new mount must read storage again after changes made while no cards were mounted.
  favoriteRaw = undefined;
  cartRaw = undefined;
}

function subscribe(listeners: Set<Listener>, listener: Listener) {
  listeners.add(listener);
  attach();
  return () => { listeners.delete(listener); detachIfUnused(); };
}

export function subscribeCardFavorites(listener: Listener) {
  return subscribe(favoriteListeners, listener);
}

export function subscribeCardCart(listener: Listener) {
  return subscribe(cartListeners, listener);
}
