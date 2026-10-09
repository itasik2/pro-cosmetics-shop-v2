import type { IncomingMessage, ServerResponse } from "node:http";
import { app } from "../src/server-offline.js";

let ready: Promise<void> | null = null;

function restoreOriginalPath(req: IncomingMessage) {
  const original = req.url || "/";
  const parsed = new URL(original, "http://catalog-hub.local");
  const path = parsed.searchParams.get("__path");
  if (path === null) return;

  parsed.searchParams.delete("__path");
  const query = parsed.searchParams.toString();
  req.url = "/" + path.replace(/^\/+/, "") + (query ? "?" + query : "");
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
) {
  restoreOriginalPath(req);
  ready ??= app.ready();
  await ready;
  app.server.emit("request", req, res);
}
