export type PriceVolumeUnit = "ml" | "g" | "pcs" | "pack" | "roll" | null;

export type ParsedPriceRow = {
  pageNumber: number;
  rowNumber: number;
  brand: string;
  supplierSku: string | null;
  originalName: string;
  normalizedName: string;
  description?: string | null;
  volumeValue: number | null;
  volumeUnit: PriceVolumeUnit;
  volumeLabel: string;
  sourcePrice: number;
  recommendedPrice?: number | null;
  productLineCode: string | null;
  productLineName: string | null;
  category: string;
  sourceDate: string | null;
  confidence: number;
  warnings: string[];
};

export type PriceParseResult = {
  parserId: "ANGIOPHARM_PDF" | "MESALTERA_PDF" | "GENERIC_PDF";
  sourceDate: string | null;
  pageCount: number;
  rows: ParsedPriceRow[];
  warnings: string[];
};

export type PriceParserMode =
  | "AUTO"
  | "ANGIOPHARM_PDF"
  | "MESALTERA_PDF"
  | "GENERIC_PDF";
