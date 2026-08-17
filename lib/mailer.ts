import nodemailer from "nodemailer";
import {
  SITE_BRAND,
  SITE_CONTACT_EMAIL,
  SITE_KEY,
  getScopedEnv,
} from "@/lib/siteConfig";

export type MailDeliveryResult =
  | { status: "sent"; provider: "smtp" | "resend"; messageId?: string }
  | { status: "skipped"; provider: "none"; reason: "not_configured" }
  | { status: "failed"; provider: "smtp" | "resend"; reason: string };

export type MailConfigurationStatus = {
  configured: boolean;
  provider: "smtp" | "resend" | "none";
  recipient: string;
  sender: string;
  host: string | null;
};

type SendSiteMailArgs = {
  subject: string;
  text: string;
  to?: string;
  replyTo?: string | null;
};

type InternalMailConfiguration = MailConfigurationStatus & {
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPassword: string;
  resendApiKey: string;
};

function parsePort(value: string, fallback: number) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 65_535
    ? parsed
    : fallback;
}

function parseBoolean(value: string, fallback: boolean) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return fallback;
  return ["1", "true", "yes", "on"].includes(normalized);
}

function getDefaultMailbox() {
  if (SITE_KEY === "procosmetics") return "sales@procosmetics.kz";
  return SITE_CONTACT_EMAIL;
}

function readMailConfiguration(): InternalMailConfiguration {
  const recipient =
    getScopedEnv("ADMIN_EMAIL").trim() ||
    SITE_CONTACT_EMAIL.trim() ||
    getDefaultMailbox();
  const smtpHost =
    getScopedEnv("SMTP_HOST").trim() ||
    (SITE_KEY === "procosmetics" ? "smtp.zoho.com" : "");
  const smtpPort = parsePort(getScopedEnv("SMTP_PORT"), 465);
  const smtpSecure = parseBoolean(
    getScopedEnv("SMTP_SECURE"),
    smtpPort === 465,
  );
  const smtpUser =
    getScopedEnv("SMTP_USER").trim() || getDefaultMailbox();
  const smtpPassword = getScopedEnv("SMTP_PASSWORD").trim();
  const resendApiKey = getScopedEnv("RESEND_API_KEY").trim();
  const smtpConfigured = Boolean(
    recipient && smtpHost && smtpUser && smtpPassword,
  );
  const resendConfigured = Boolean(recipient && resendApiKey);
  const provider = smtpConfigured
    ? "smtp"
    : resendConfigured
      ? "resend"
      : "none";
  const defaultSender =
    provider === "smtp"
      ? `${SITE_BRAND} <${smtpUser}>`
      : `${SITE_BRAND} <onboarding@resend.dev>`;

  return {
    configured: provider !== "none",
    provider,
    recipient,
    sender: getScopedEnv("EMAIL_FROM").trim() || defaultSender,
    host: provider === "smtp" ? smtpHost : null,
    smtpPort,
    smtpSecure,
    smtpUser,
    smtpPassword,
    resendApiKey,
  };
}

export function getMailConfigurationStatus(): MailConfigurationStatus {
  const config = readMailConfiguration();
  return {
    configured: config.configured,
    provider: config.provider,
    recipient: config.recipient,
    sender: config.sender,
    host: config.host,
  };
}

async function sendWithSmtp(
  config: InternalMailConfiguration,
  args: SendSiteMailArgs,
): Promise<MailDeliveryResult> {
  try {
    const transporter = nodemailer.createTransport({
      host: config.host || undefined,
      port: config.smtpPort,
      secure: config.smtpSecure,
      auth: {
        user: config.smtpUser,
        pass: config.smtpPassword,
      },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
    const info = await transporter.sendMail({
      from: config.sender,
      to: args.to || config.recipient,
      replyTo: args.replyTo || undefined,
      subject: args.subject,
      text: args.text,
    });

    return {
      status: "sent",
      provider: "smtp",
      messageId: String(info.messageId || "") || undefined,
    };
  } catch (error) {
    const reason =
      error instanceof Error ? error.message.slice(0, 300) : "smtp_failed";
    console.error("[mail] SMTP delivery failed:", reason);
    return { status: "failed", provider: "smtp", reason };
  }
}

async function sendWithResend(
  config: InternalMailConfiguration,
  args: SendSiteMailArgs,
): Promise<MailDeliveryResult> {
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: config.sender,
        to: [args.to || config.recipient],
        reply_to: args.replyTo || undefined,
        subject: args.subject,
        text: args.text,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await response.json().catch(() => ({}))) as {
      id?: string;
      message?: string;
    };

    if (!response.ok) {
      const reason = String(body.message || `resend_http_${response.status}`).slice(
        0,
        300,
      );
      console.error("[mail] Resend delivery failed:", reason);
      return { status: "failed", provider: "resend", reason };
    }

    return {
      status: "sent",
      provider: "resend",
      messageId: body.id,
    };
  } catch (error) {
    const reason =
      error instanceof Error ? error.message.slice(0, 300) : "resend_failed";
    console.error("[mail] Resend delivery failed:", reason);
    return { status: "failed", provider: "resend", reason };
  }
}

export async function sendSiteMail(
  args: SendSiteMailArgs,
): Promise<MailDeliveryResult> {
  const config = readMailConfiguration();

  if (!config.configured || config.provider === "none") {
    console.warn("[mail] Delivery skipped: email is not configured.");
    return { status: "skipped", provider: "none", reason: "not_configured" };
  }

  return config.provider === "smtp"
    ? sendWithSmtp(config, args)
    : sendWithResend(config, args);
}
