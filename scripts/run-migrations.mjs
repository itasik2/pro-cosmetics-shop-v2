#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const candidates = [
  ["DIRECT_URL", process.env.DIRECT_URL],
  ["DATABASE_URL_UNPOOLED", process.env.DATABASE_URL_UNPOOLED],
  ["POSTGRES_URL_NON_POOLING", process.env.POSTGRES_URL_NON_POOLING],
];

const selected = candidates.find(([, value]) =>
  typeof value === "string" && value.trim().length > 0,
);

if (!selected) {
  console.error(
    "[migrate] A direct PostgreSQL connection is required. Set DIRECT_URL, DATABASE_URL_UNPOOLED, or POSTGRES_URL_NON_POOLING.",
  );
  process.exit(1);
}

const [sourceName, directUrl] = selected;

let hostname = "unknown";
try {
  hostname = new URL(directUrl).hostname;
} catch {
  console.error(`[migrate] ${sourceName} is not a valid PostgreSQL URL.`);
  process.exit(1);
}

if (hostname.includes("-pooler")) {
  console.error(
    `[migrate] ${sourceName} points to a pooled Neon host (${hostname}). Use the unpooled hostname without \"-pooler\" for migrations.`,
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
