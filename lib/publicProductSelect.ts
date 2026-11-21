export const PUBLIC_PRODUCT_IMAGE_SOURCES = {
  where: {
    url: { startsWith: "https://res.cloudinary.com/" },
    sourceUrl: { startsWith: "https://" },
    NOT: { sourceUrl: { startsWith: "https://res.cloudinary.com/" } },
  },
  select: { url: true, sourceUrl: true },
} as const;

// List pages need card data and identity fields for grouping, not full descriptions or supplier prices.
export const PUBLIC_PRODUCT_CARD_SELECT = {
  id: true, slug: true, name: true, image: true, imageSourceUrl: true, shortDescription: true,
  price: true, stock: true, isPopular: true, isNew: true, createdAt: true,
  category: true, productLineName: true, supplierId: true, supplierSku: true,
  volumeValue: true, volumeUnit: true, variants: true,
  images: PUBLIC_PRODUCT_IMAGE_SOURCES,
  brand: { select: { name: true } },
} as const;
