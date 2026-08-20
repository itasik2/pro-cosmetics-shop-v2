import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { getPublicBaseUrl, getScopedEnv } from "@/lib/siteConfig";

export type HalykEpayMode = "test" | "production";

export type HalykTransactionStatusResponse = {
  resultCode?: string | number;
  resultMessage?: string;
  transaction?: {
    id?: string;
    invoiceID?: string;
    invoiceId?: string;
    amount?: number;
    currency?: string;
    terminal?: string;
    terminalID?: string;
    reference?: string;
    reason?: string;
    reasonCode?: string | number;
    statusName?: string;
    cardMask?: string;
    cardType?: string;
  } | null;
};

type HalykPaymentSessionArgs = {
  orderId: string;
  orderNumber: string;
  invoiceId: string;
  amount: number;
  currency: string;
  phone?: string | null;
  email?: string | null;
  backLink: string;
  failureBackLink: string;
};

function getMode(): HalykEpayMode {
  return getScopedEnv("HALYK_EPAY_MODE").trim().toLowerCase() === "production"
    ? "production"
    : "test";
}

function getConfig() {
  const mode = getMode();
  const isProduction = mode === "production";

  return {
    mode,
    clientId: getScopedEnv("HALYK_EPAY_CLIENT_ID").trim(),
    clientSecret: getScopedEnv("HALYK_EPAY_CLIENT_SECRET").trim(),
    terminalId: getScopedEnv("HALYK_EPAY_TERMINAL_ID").trim(),
    callbackSecret:
      getScopedEnv("HALYK_EPAY_CALLBACK_SECRET").trim() ||
      String(process.env.ORDER_ACCESS_SECRET || "").trim() ||
      String(process.env.NEXTAUTH_SECRET || "").trim(),
    oauthUrl:
      getScopedEnv("HALYK_EPAY_OAUTH_URL").trim() ||
      (isProduction
        ? "https://epay-oauth.homebank.kz/oauth2/token"
        : "https://test-epay-oauth.epayment.kz/oauth2/token"),
    statusBaseUrl:
      getScopedEnv("HALYK_EPAY_STATUS_URL").trim() ||
      (isProduction
        ? "https://epay-api.homebank.kz/check-status/payment/transaction"
        : "https://test-epay-api.epayment.kz/check-status/payment/transaction"),
    scriptUrl:
      getScopedEnv("HALYK_EPAY_SCRIPT_URL").trim() ||
      (isProduction
        ? "https://epay.homebank.kz/payform/payment-api.js"
        : "https://test-epay.epayment.kz/payform/payment-api.js"),
  };
}

function getCallbackBaseUrl() {
  const configured = getScopedEnv("HALYK_EPAY_PUBLIC_URL").trim();
  const raw = configured || getPublicBaseUrl();

  try {
    const url = new URL(raw);
    // procosmetics.kz redirects to www. Server-to-server callbacks must not rely on that redirect.
    if (!configured && url.hostname === "procosmetics.kz") {
      url.hostname = "www.procosmetics.kz";
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return raw.replace(/\/$/, "");
  }
}

function normalizePhone(value?: string | null) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("8")) {
    digits = `7${digits.slice(1)}`;
  } else if (digits.length === 10) {
    digits = `7${digits}`;
  }
  return digits.length >= 10 && digits.length <= 15 ? digits : "";
}

function signedValue(label: string, orderId: string, invoiceId: string) {
  const { callbackSecret: secret } = getConfig();
  if (!secret) throw new Error("halyk_callback_secret_not_configured");

  return createHmac("sha256", secret)
    .update(`halyk-epay:${label}:${orderId}:${invoiceId}`)
    .digest("base64url");
}

function secureEqual(expected: string, provided: string) {
  if (!expected || !provided) return false;
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function verifyHalykCallbackSecret(
  orderId: string,
  invoiceId: string,
  provided: string,
) {
  try {
    return secureEqual(signedValue("callback", orderId, invoiceId), provided);
  } catch {
    return false;
  }
}

export function createHalykReturnState(orderId: string, invoiceId: string) {
  return signedValue("return", orderId, invoiceId);
}

export function verifyHalykReturnState(
  orderId: string,
  invoiceId: string,
  provided: string,
) {
  try {
    return secureEqual(signedValue("return", orderId, invoiceId), provided);
  } catch {
    return false;
  }
}

export function isHalykEpayConfigured() {
  const config = getConfig();
  return Boolean(
    config.clientId &&
      config.clientSecret &&
      config.terminalId &&
      config.callbackSecret,
  );
}

export function getHalykEpayMode() {
  return getMode();
}

export function generateHalykInvoiceIdCandidate() {
  // Halyk requires 6-15 digits. The last six digits are checked for uniqueness
  // by ensureHalykInvoiceId() before the value is assigned to an order.
  const prefix = String(Date.now() % 1_000_000_000).padStart(9, "0");
  const suffix = String(randomInt(100_000, 1_000_000));
  return `${prefix}${suffix}`;
}

async function parseResponse(response: Response) {
  const text = await response.text();
  if (!text) return {} as Record<string, unknown>;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { raw: text.slice(0, 500) } as Record<string, unknown>;
  }
}

function responseError(
  prefix: string,
  response: Response,
  body: Record<string, unknown>,
) {
  const description = String(
    body.error_description || body.error || body.message || body.raw || "",
  ).slice(0, 300);
  return new Error(
    description
      ? `${prefix}_${response.status}:${description}`
      : `${prefix}_${response.status}`,
  );
}

export async function createHalykPaymentSession(args: HalykPaymentSessionArgs) {
  const config = getConfig();
  if (!isHalykEpayConfigured()) {
    throw new Error("halyk_not_configured");
  }

  const postLink = `${getCallbackBaseUrl()}/api/payments/halyk/callback`;
  const secretHash = signedValue("callback", args.orderId, args.invoiceId);
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    scope: "payment",
    client_id: config.clientId,
    client_secret: config.clientSecret,
    invoiceID: args.invoiceId,
    secret_hash: secretHash,
    amount: String(args.amount),
    currency: args.currency,
    terminal: config.terminalId,
    postLink,
    failurePostLink: postLink,
  });

  const response = await fetch(config.oauthUrl, {
    method: "POST",
    headers: { Accept: "application/json" },
    body,
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const auth = await parseResponse(response);
  if (!response.ok || !String(auth.access_token || "")) {
    throw responseError("halyk_oauth", response, auth);
  }

  const phone = normalizePhone(args.phone);
  const paymentObject: Record<string, unknown> = {
    invoiceId: args.invoiceId,
    backLink: args.backLink,
    failureBackLink: args.failureBackLink,
    postLink,
    failurePostLink: postLink,
    language: "RU",
    description: `Оплата заказа ${args.orderNumber}`,
    accountId: args.orderId,
    terminal: config.terminalId,
    amount: args.amount,
    currency: args.currency,
    data: JSON.stringify({ orderNumber: args.orderNumber }),
    auth,
  };

  if (phone) paymentObject.phone = phone;
  if (args.email) paymentObject.email = args.email.trim();

  return {
    mode: config.mode,
    scriptUrl: config.scriptUrl,
    paymentObject,
  };
}

async function getStatusAccessToken() {
  const config = getConfig();
  if (!isHalykEpayConfigured()) {
    throw new Error("halyk_not_configured");
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    scope: "webapi usermanagement email_send verification statement statistics payment",
    client_id: config.clientId,
    client_secret: config.clientSecret,
    terminal: config.terminalId,
  });

  const response = await fetch(config.oauthUrl, {
    method: "POST",
    headers: { Accept: "application/json" },
    body,
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const auth = await parseResponse(response);
  if (!response.ok || !String(auth.access_token || "")) {
    throw responseError("halyk_status_oauth", response, auth);
  }
  return String(auth.access_token);
}

export async function getHalykTransactionStatus(
  invoiceId: string,
): Promise<HalykTransactionStatusResponse> {
  const config = getConfig();
  const accessToken = await getStatusAccessToken();
  const response = await fetch(
    `${config.statusBaseUrl.replace(/\/$/, "")}/${encodeURIComponent(invoiceId)}`,
    {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    },
  );

  const body = (await parseResponse(response)) as HalykTransactionStatusResponse &
    Record<string, unknown>;
  if (!response.ok) throw responseError("halyk_status", response, body);
  return body;
}

export function classifyHalykTransaction(
  response: HalykTransactionStatusResponse,
  expected: { amount: number; currency: string },
) {
  const transaction = response.transaction || null;
  const resultCode = String(response.resultCode || "");
  const statusName = String(transaction?.statusName || "").toUpperCase();
  const amount = Number(transaction?.amount);
  const currency = String(transaction?.currency || "").toUpperCase();
  const config = getConfig();
  const terminalId = String(transaction?.terminalID || "");

  const matchesOrder =
    Boolean(transaction) &&
    Number.isFinite(amount) &&
    Math.abs(amount - expected.amount) < 0.001 &&
    currency === expected.currency.toUpperCase() &&
    (!terminalId || terminalId === config.terminalId);

  if (resultCode === "100" && statusName === "CHARGE" && matchesOrder) {
    return { state: "PAID" as const, statusName, transaction };
  }

  if (
    resultCode === "107" ||
    (resultCode === "100" && ["NEW", "FINGERPRINT", "AUTH"].includes(statusName))
  ) {
    return { state: "PENDING" as const, statusName: statusName || resultCode, transaction };
  }

  if (resultCode === "102") {
    return { state: "UNPAID" as const, statusName: "NOT_FOUND", transaction };
  }

  return {
    state: "FAILED" as const,
    statusName: statusName || response.resultMessage || resultCode || "UNKNOWN",
    transaction,
  };
}
