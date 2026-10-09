export type ImportFormat =
  | "auto"
  | "csv"
  | "xlsx"
  | "json"
  | "xml"
  | "yml"
  | "yaml";

export function detectImportFormat(input: {
  filename?: string;
  contentType?: string;
  text?: string;
}): Exclude<ImportFormat, "auto"> {
  const filename = input.filename?.toLowerCase() ?? "";
  const contentType = input.contentType?.toLowerCase() ?? "";

  if (filename.endsWith(".xlsx") || filename.endsWith(".xls")) return "xlsx";
  if (filename.endsWith(".csv") || filename.endsWith(".tsv")) return "csv";
  if (filename.endsWith(".json") || contentType.includes("application/json")) {
    return "json";
  }
  if (
    filename.endsWith(".yml") ||
    filename.endsWith(".yaml") ||
    contentType.includes("yaml")
  ) {
    return filename.endsWith(".yaml") ? "yaml" : "yml";
  }
  if (filename.endsWith(".xml") || contentType.includes("xml")) return "xml";

  const sample = input.text?.trimStart() ?? "";
  if (sample.startsWith("{") || sample.startsWith("[")) return "json";
  if (sample.startsWith("<")) return "xml";

  return "csv";
}
