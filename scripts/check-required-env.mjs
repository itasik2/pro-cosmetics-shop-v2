#!/usr/bin/env node

const requiredVarsByCommand = {
  build: ["DATABASE_URL"],
};

const command = process.argv[2] ?? "build";
const requiredVars = requiredVarsByCommand[command] ?? [];

const missingVars = requiredVars.filter((envVar) => {
  const value = process.env[envVar];
  return typeof value !== "string" || value.trim().length === 0;
});

if (missingVars.length > 0) {
  console.error(
    `[env-check] Missing required environment variables for \`${command}\`: ${missingVars.join(", ")}`,
  );
  process.exit(1);
}

console.log(`[env-check] All required environment variables are set for \`${command}\`.`);
