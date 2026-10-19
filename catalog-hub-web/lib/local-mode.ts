/**
 * Local test writes are permitted only when BOTH the explicit switch and a
 * loopback-only API are configured. Never allow the Ubuntu development server
 * to mutate the production Supabase API by changing one env flag.
 */
type LocalModeEnv = Partial<Pick<NodeJS.ProcessEnv,
  "NODE_ENV" | "CATALOG_HUB_LOCAL_MODE" |
  "CATALOG_HUB_LOCAL_WRITE_ENABLED" | "CATALOG_HUB_API_URL"
>>;
export function isAllowedTestApiUrl(raw: string | undefined): boolean {
  if (!raw) return false;
  try {
    const url = new URL(raw);
    return url.protocol === "http:" &&
      (url.hostname === "127.0.0.1" || url.hostname === "localhost") &&
      (url.port === "8000" || url.port === "54321") &&
      !url.username && !url.password;
  } catch {
    return false;
  }
}
export function isLocalReadOnly(env: LocalModeEnv = process.env): boolean {
  const local = env.NODE_ENV === "development" || env.CATALOG_HUB_LOCAL_MODE === "true";
  if (!local) return false;
  return env.CATALOG_HUB_LOCAL_WRITE_ENABLED !== "true" ||
    !isAllowedTestApiUrl(env.CATALOG_HUB_API_URL);
}
export function isMutation(method?: string): boolean {
  return !["GET", "HEAD", "OPTIONS"].includes((method || "GET").toUpperCase());
}
