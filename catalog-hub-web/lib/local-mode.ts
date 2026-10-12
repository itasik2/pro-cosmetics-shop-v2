/**
 * Local editing can point at the same Supabase API used in production.
 * Fail closed: development UI writes must be explicitly enabled.
 */
export function isLocalReadOnly(
  env: Pick<NodeJS.ProcessEnv, "NODE_ENV" | "CATALOG_HUB_LOCAL_MODE" | "CATALOG_HUB_LOCAL_WRITE_ENABLED"> = process.env,
): boolean {
  return (env.NODE_ENV === "development" || env.CATALOG_HUB_LOCAL_MODE === "true") &&
    env.CATALOG_HUB_LOCAL_WRITE_ENABLED !== "true";
}

export function isMutation(method?: string): boolean {
  return !["GET", "HEAD", "OPTIONS"].includes((method || "GET").toUpperCase());
}
