import { XMLParser } from "fast-xml-parser";
import YAML from "yaml";
import type { ImportedRow } from "./importer.js";

function getPath(value: unknown, path?: string): unknown {
  if (!path?.trim()) return value;

  return path
    .split(".")
    .filter(Boolean)
    .reduce<unknown>((current, key) => {
      if (current && typeof current === "object" && !Array.isArray(current)) {
        return (current as Record<string, unknown>)[key];
      }
      return undefined;
    }, value);
}

function primitiveToString(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function flatten(
  value: unknown,
  prefix = "",
  output: ImportedRow = {},
): ImportedRow {
  if (value === null || value === undefined) {
    if (prefix) output[prefix] = "";
    return output;
  }

  if (Array.isArray(value)) {
    if (prefix) output[prefix] = JSON.stringify(value);
    return output;
  }

  if (typeof value !== "object") {
    if (prefix) output[prefix] = primitiveToString(value);
    return output;
  }

  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (
      nested !== null &&
      typeof nested === "object" &&
      !Array.isArray(nested)
    ) {
      flatten(nested, path, output);
    } else {
      output[path] = primitiveToString(nested);
    }
  }

  return output;
}

function toRows(value: unknown, collectionPath?: string): ImportedRow[] {
  const collection = getPath(value, collectionPath);

  if (Array.isArray(collection)) {
    return collection.map((item) =>
      item && typeof item === "object"
        ? flatten(item)
        : { value: primitiveToString(item) },
    );
  }

  if (collection && typeof collection === "object") {
    return [flatten(collection)];
  }

  throw new Error(
    collectionPath
      ? `Collection path "${collectionPath}" does not resolve to an object or array`
      : "Structured catalog must contain an object or array",
  );
}

export function parseJson(text: string, collectionPath?: string) {
  return toRows(JSON.parse(text), collectionPath);
}

export function parseYaml(text: string, collectionPath?: string) {
  return toRows(YAML.parse(text), collectionPath);
}

export function parseXml(text: string, collectionPath?: string) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@",
    textNodeName: "#text",
    parseTagValue: false,
    trimValues: true,
  });

  return toRows(parser.parse(text), collectionPath);
}
