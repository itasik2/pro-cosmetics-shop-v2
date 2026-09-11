export function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function parseDelayValue(value: string | null | undefined) {
  if (!value) return null;
  const text = value.trim().toLowerCase();
  if (!text) return null;

  const milliseconds = text.match(/^(\d+(?:\.\d+)?)\s*ms$/);
  if (milliseconds) return Math.ceil(Number(milliseconds[1]));

  const seconds = text.match(/^(\d+(?:\.\d+)?)\s*s?$/);
  if (seconds) return Math.ceil(Number(seconds[1]) * 1000);

  return null;
}

export function retryDelayMs(response: Response, bodyText: string, attempt: number) {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const numeric = Number(retryAfter);
    if (Number.isFinite(numeric) && numeric >= 0) {
      return Math.min(10_000, Math.max(250, Math.ceil(numeric * 1000)));
    }

    const parsedDate = Date.parse(retryAfter);
    if (Number.isFinite(parsedDate)) {
      return Math.min(10_000, Math.max(250, parsedDate - Date.now()));
    }
  }

  const resetTokens = parseDelayValue(response.headers.get("x-ratelimit-reset-tokens"));
  if (resetTokens !== null) {
    return Math.min(10_000, Math.max(250, resetTokens));
  }

  const bodyDelay = bodyText.match(/try again in\s+(\d+(?:\.\d+)?)\s*(ms|s)/i);
  if (bodyDelay) {
    const value = Number(bodyDelay[1]);
    const ms = bodyDelay[2].toLowerCase() === "s" ? value * 1000 : value;
    if (Number.isFinite(ms)) return Math.min(10_000, Math.max(250, Math.ceil(ms)));
  }

  const exponential = Math.min(8_000, 500 * 2 ** Math.max(0, attempt));
  return exponential + Math.floor(Math.random() * 250);
}

export function retryableOpenAiStatus(status: number) {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}
