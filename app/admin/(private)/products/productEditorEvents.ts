import type { Product } from "./productTypes";

export const PRODUCT_EDITOR_EVENT = "admin-product-edit";
export type ProductEditorRequest = {
  product: Product;
  section: "details" | "assistant";
};

export function requestProductEditor(product: Product) {
  window.dispatchEvent(
    new CustomEvent<ProductEditorRequest>(PRODUCT_EDITOR_EVENT, {
      detail: { product, section: "assistant" },
    }),
  );
}
