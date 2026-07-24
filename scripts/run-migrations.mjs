#!/usr/bin/env node

import { spawnSync } from "node:child_process";

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

console.log(`[migrate] Running Prisma migrations through ${sourceName} (${hostname}).`);

const result = spawnSync(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["prisma", "migrate", "deploy"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_URL: directUrl,
    },
  },
);

if (result.error) {
  console.error(`[migrate] Failed to start Prisma: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
