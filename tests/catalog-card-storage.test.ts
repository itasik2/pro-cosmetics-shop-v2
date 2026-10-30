import assert from "node:assert/strict";
import test from "node:test";
import {
  cardCartQty, isCardFavorite, subscribeCardCart, subscribeCardFavorites,
} from "../lib/catalogCardStorage";

test("many cards share one storage listener and update only when their data changes", (t) => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const data = new Map<string, string>();
  const events = new EventTarget();
  const counts = new Map<string, number>();
  let reads = 0;
  const nativeAdd = events.addEventListener.bind(events);
  events.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
    counts.set(type, (counts.get(type) || 0) + 1);
    nativeAdd(type, listener, options);
  }) as typeof events.addEventListener;
  Object.defineProperty(events, "localStorage", { value: {
    getItem: (key: string) => { reads++; return data.get(key) ?? null; },
  } });
  Object.defineProperty(globalThis, "window", { configurable: true, value: events });
  t.after(() => {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  });

  assert.equal(isCardFavorite("one"), false);
  assert.equal(cardCartQty("one:base"), 0);
  let favoriteUpdates = 0, cartUpdates = 0;
  const unsubscribe = Array.from({ length: 30 }, () => [
    subscribeCardFavorites(() => favoriteUpdates++), subscribeCardCart(() => cartUpdates++),
  ]).flat();
  assert.equal(counts.get("storage"), 1);
  assert.equal(counts.get("storage-sync"), 1);
  assert.equal(counts.get("favorites:changed"), 1);

  data.set("favorites", '["one"]');
  events.dispatchEvent(new Event("favorites:changed"));
  events.dispatchEvent(new Event("storage-sync"));
  assert.equal(isCardFavorite("one"), true);
  assert.equal(favoriteUpdates, 30);
  assert.equal(cartUpdates, 0);

  data.set("cart", '[{"id":"one","qty":2},{"id":"one:base","qty":1}]');
  const beforeSyncReads = reads;
  events.dispatchEvent(new Event("storage-sync"));
  assert.equal(cardCartQty("one:base"), 2);
  assert.equal(cartUpdates, 30);
  assert.equal(favoriteUpdates, 30);
  assert.ok(reads - beforeSyncReads <= 2, "a cart event reads storage once per key, not once per card");

  data.set("favorites", '["two"]');
  events.dispatchEvent(Object.assign(new Event("storage"), { key: "favorites" }));
  assert.equal(isCardFavorite("one"), false);
  assert.equal(isCardFavorite("two"), true);
  assert.equal(favoriteUpdates, 60);

  unsubscribe.forEach(fn => fn());
  data.set("cart", '[{"id":"one:base","qty":3}]');
  assert.equal(cardCartQty("one:base"), 3);
  events.dispatchEvent(new Event("storage-sync"));
  assert.equal(cartUpdates, 30);
});
