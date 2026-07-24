#!/usr/bin/env node

import { spawnSync } from "node:child_process";

function isTruthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").toLowerCase());
}

function sleep(milliseconds) {
  Atomics.wait(
    new Int32Array(new SharedArrayBuffer(4)),
    0,
    0,
    milliseconds,
  );
}

if (
  process.env.VERCEL_ENV === "preview" &&
  !isTruthy(process.env.RUN_MIGRATIONS_ON_PREVIEW)
) {
  console.log(
    "[migrate] Skipping database migrations for Vercel Preview. Set RUN_MIGRATIONS_ON_PREVIEW=true to override.",
  );
  process.exit(0);
}

const explicitCandidates = [
  ["DIRECT_URL", process.env.DIRECT_URL],
  ["DATABASE_URL_UNPOOLED", process.env.DATABASE_URL_UNPOOLED],
  ["POSTGRES_URL_NON_POOLING", process.env.POSTGRES_URL_NON_POOLING],
];

const explicit = explicitCandidates.find(([, value]) =>
  typeof value === "string" && value.trim().length > 0,
);

let sourceName;
let directUrl;

if (explicit) {
  [sourceName, directUrl] = explicit;
} else {
  const runtimeUrl = process.env.DATABASE_URL?.trim();

  if (!runtimeUrl) {
    console.error(
      "[migrate] DATABASE_URL is missing and no direct database URL was provided.",
    );
    process.exit(1);
  }

  let parsedRuntimeUrl;
  try {
    parsedRuntimeUrl = new URL(runtimeUrl);
  } catch {
    console.error("[migrate] DATABASE_URL is not a valid PostgreSQL URL.");
    process.exit(1);
  }

  const runtimeHostname = parsedRuntimeUrl.hostname.toLowerCase();

  if (
    runtimeHostname.endsWith(".neon.tech") &&
    runtimeHostname.includes("-pooler")
  ) {
    parsedRuntimeUrl.hostname = runtimeHostname.replace(/-pooler(?=\.)/, "");
    sourceName = "DATABASE_URL (derived Neon direct endpoint)";
    directUrl = parsedRuntimeUrl.toString();
  } else if (!runtimeHostname.includes("-pooler")) {
    sourceName = "DATABASE_URL";
    directUrl = runtimeUrl;
  } else {
    console.error(
      "[migrate] A pooled database URL was detected, but its direct endpoint cannot be derived safely. Set DIRECT_URL, DATABASE_URL_UNPOOLED, or POSTGRES_URL_NON_POOLING.",
    );
    process.exit(1);
  }
}

let hostname = "unknown";
try {
  hostname = new URL(directUrl).hostname;
} catch {
  console.error(`[migrate] ${sourceName} is not a valid PostgreSQL URL.`);
  process.exit(1);
}

if (hostname.includes("-pooler")) {
  console.error(
    `[migrate] ${sourceName} points to a pooled host (${hostname}). Use a direct database endpoint for migrations.`,
  );
  process.exit(1);
}

const disableAdvisoryLock =
  process.env.VERCEL_ENV === "production" ||
  isTruthy(process.env.PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK);

const migrationEnv = {
  ...process.env,
  DATABASE_URL: directUrl,
};

if (disableAdvisoryLock) {
  migrationEnv.PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK = "1";
  console.warn(
    "[migrate] Prisma advisory locking is disabled for this production migration run. Preview migrations remain disabled.",
  );
}

const maxAttempts = disableAdvisoryLock ? 1 : 3;

for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  console.log(
    `[migrate] Running Prisma migrations through ${sourceName} (${hostname}), attempt ${attempt}/${maxAttempts}.`,
  );

  const result = spawnSync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["prisma", "migrate", "deploy"],
    {
      encoding: "utf8",
      env: migrationEnv,
    },
  );

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  if (result.error) {
    console.error(`[migrate] Failed to start Prisma: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status === 0) process.exit(0);

  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  const advisoryLockTimeout =
    output.includes("P1002") || /advisory lock/i.test(output);

  if (!advisoryLockTimeout || attempt === maxAttempts) {
    process.exit(result.status ?? 1);
  }

  const delayMs = attempt * 15_000;
  console.warn(
    `[migrate] Advisory lock timeout detected. Retrying in ${delayMs / 1000} seconds.`,
  );
  sleep(delayMs);
}

process.exit(1);
