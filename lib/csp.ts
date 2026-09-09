import { headers } from "next/headers";

export async function getCspNonce() {
  const value = (await headers()).get("x-nonce");
  return value || undefined;
}
