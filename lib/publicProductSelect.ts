// List pages need card data and identity fields for grouping, not full descriptions or supplier prices.
export const PUBLIC_PRODUCT_CARD_SELECT = {
  id: true, slug: true, name: true, image: true, shortDescription: true,
  price: true, stock: true, isPopular: true, isNew: true, createdAt: true,
  category: true, productLineName: true, supplierId: true, supplierSku: true,
  volumeValue: true, volumeUnit: true, variants: true,
  brand: { select: { name: true } },
} as const;
