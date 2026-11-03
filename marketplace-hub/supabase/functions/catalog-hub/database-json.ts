import type postgres from "npm:postgres@3.4.7";

/** Request JSON and PostgreSQL JSONB are serializable, even when their field
 * schemas deliberately keep arbitrary supplier attributes typed as unknown. */
export function jsonParam(sql: Pick<postgres.Sql, "json">, value: unknown) {
  return sql.json(value as postgres.JSONValue);
}
