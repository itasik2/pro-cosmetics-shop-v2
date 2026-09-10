#!/usr/bin/env node

const command = process.argv[2] ?? "build";
const siteKey = String(process.env.SITE_KEY || "procosmetics").trim();
const siteSuffix = siteKey.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase();
const productionDeploy =
  process.env.VERCEL_ENV === "production" ||
  process.env.REQUIRE_PRODUCTION_SECRETS === "true";

function scoped(name) {
  return String(
    process.env[`${name}_${siteSuffix}`] || process.env[name] || "",
  ).trim();
}

function direct(name) {
  return String(process.env[name] || "").trim();
}

const errors = [];
const warnings = [];

function requireValue(label, value) {
  if (!value) errors.push(`${label} is missing`);
}

function requireMinLength(label, value, min) {
  requireValue(label, value);
  if (value && value.length < min) {
    errors.push(`${label} must be at least ${min} characters`);
  }
}

function warnMissing(label, value) {
  if (!value) warnings.push(`${label} is missing; related feature will remain disabled/fail-closed`);
}

if (command === "build") {
  requireValue("DATABASE_URL", direct("DATABASE_URL"));
}

if (command === "build" && productionDeploy) {
  const authSecret = direct("AUTH_SECRET") || direct("NEXTAUTH_SECRET");
  const orderAccessSecret = scoped("ORDER_ACCESS_SECRET") || authSecret;

  requireMinLength("AUTH_SECRET or NEXTAUTH_SECRET", authSecret, 32);
  requireValue("AUTH_ADMIN_EMAIL", scoped("AUTH_ADMIN_EMAIL"));
  requireMinLength("AUTH_ADMIN_PASSWORD", scoped("AUTH_ADMIN_PASSWORD"), 16);
  requireMinLength(
    "ORDER_ACCESS_SECRET or AUTH_SECRET/NEXTAUTH_SECRET",
    orderAccessSecret,
    32,
  );

  // Optional operational integrations are fail-closed at runtime. Missing
  // credentials should not take the storefront offline during deployment.
  warnMissing("CRON_SECRET", direct("CRON_SECRET"));

  const telegramToken = scoped("TELEGRAM_BOT_TOKEN");
  if (telegramToken) {
    const telegramLinkSecret =
      scoped("TELEGRAM_LINK_SECRET") || orderAccessSecret;

    warnMissing("TELEGRAM_BOT_USERNAME", scoped("TELEGRAM_BOT_USERNAME"));
    warnMissing("TELEGRAM_WEBHOOK_SECRET", scoped("TELEGRAM_WEBHOOK_SECRET"));
    if (telegramLinkSecret.length < 32) {
      warnings.push(
        "TELEGRAM_LINK_SECRET or ORDER_ACCESS_SECRET/AUTH_SECRET is too short; Telegram linking will remain unavailable",
      );
    }
  }

  const halykMode = scoped("HALYK_EPAY_MODE").toLowerCase();
  if (halykMode === "production") {
    requireValue("HALYK_EPAY_CLIENT_ID", scoped("HALYK_EPAY_CLIENT_ID"));
    requireValue("HALYK_EPAY_CLIENT_SECRET", scoped("HALYK_EPAY_CLIENT_SECRET"));
    requireValue("HALYK_EPAY_TERMINAL_ID", scoped("HALYK_EPAY_TERMINAL_ID"));
    requireMinLength(
      "HALYK_EPAY_CALLBACK_SECRET",
      scoped("HALYK_EPAY_CALLBACK_SECRET"),
      32,
    );
  }
}

if (warnings.length > 0) {
  console.warn(`[env-check] ${warnings.length} warning(s):`);
  for (const warning of warnings) console.warn(`- ${warning}`);
}

if (errors.length > 0) {
  console.error(`[env-check] ${errors.length} configuration error(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  `[env-check] Environment is valid for \`${command}\`${
    productionDeploy ? " production deployment" : ""
  }.`,
);
