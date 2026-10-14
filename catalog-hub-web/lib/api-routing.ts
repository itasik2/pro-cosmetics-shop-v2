export function hubBaseForPath(path: string, env: {
  CATALOG_HUB_API_URL?: string; CATALOG_HUB_AI_API_URL?: string;
  CATALOG_HUB_LOCAL_MODE?: string; NODE_ENV?: string;
}) {
  const main = (env.CATALOG_HUB_API_URL || "").replace(/\/$/, "");
  const aiPath = /^\/v1\/(?:ai\/enrichment(?:\/|\?|$)|suppliers(?:\/|\?|$)|source-policies(?:\/|\?|$))/.test(path) ||
    /^\/v1\/staging\/changesets\/c[a-z0-9]{24}(?:\/|\?|$)/.test(path);
  if (!aiPath) return main;
  const local = env.CATALOG_HUB_LOCAL_MODE === "true" || env.NODE_ENV === "development";
  const isolated = env.CATALOG_HUB_LOCAL_MODE === "true" && main === "http://127.0.0.1:8000";
  const ai = env.CATALOG_HUB_AI_API_URL?.replace(/\/$/, "") || (isolated ? "http://127.0.0.1:8001" : main);
  if (local && ai !== main && ai !== "http://127.0.0.1:8001") throw new Error("local_ai_api_must_use_loopback");
  return ai;
}
