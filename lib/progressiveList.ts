export const CATALOG_BATCH_SIZE = 24;
export const CATALOG_INITIAL_SIZE = 6;
export const ADMIN_PRODUCT_BATCH_SIZE = 30;

// Observe each batch once. The next render installs a new observer at the new end.
export function observeListEnd(target: Element, revealNext: () => void, revealAll: () => void) {
  if (typeof IntersectionObserver === "undefined") {
    revealAll();
    return () => {};
  }

  let active = true;
  const observer = new IntersectionObserver((entries) => {
    if (!active || !entries.some((entry) => entry.isIntersecting)) return;
    active = false;
    observer.disconnect();
    revealNext();
  }, { rootMargin: "800px 0px" });
  observer.observe(target);

  return () => {
    active = false;
    observer.disconnect();
  };
}
