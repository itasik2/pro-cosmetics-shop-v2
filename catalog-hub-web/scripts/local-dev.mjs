import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const hub = resolve(web, "../marketplace-hub");
const config = {};
const file = resolve(web, ".env.local");
if (existsSync(file)) for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match) config[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
}
const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  process.exitCode = code;
}
function launch(cwd, args, env) {
  const child = spawn(process.execPath, args, { cwd, env, stdio: "inherit" });
  children.push(child);
  child.on("error", error => { console.error(error.message); stop(1); });
  child.on("exit", code => stop(code || 0));
  return child;
}
if (config.CATALOG_HUB_LOCAL_MODE === "true" && config.CATALOG_HUB_API_URL === "http://127.0.0.1:8000") {
  if (!existsSync(resolve(hub, "node_modules/tsx")) || !config.CATALOG_HUB_API_KEY) {
    console.error("Сначала выполните npm run testdb:setup и npm run testdb:use.");
    process.exit(1);
  }
  console.log("Запуск локального сервиса обогащения: 127.0.0.1:8001 (только тестовая база).");
  launch(hub, ["--import", "tsx", "src/server-offline.ts"], {
    ...process.env, NODE_ENV: "development", VERCEL: "0", HOST: "127.0.0.1", PORT: "8001",
    DATABASE_URL: "postgresql://catalog_test:catalog_test_only@127.0.0.1:55432/catalog_test",
    CATALOG_HUB_AUTH_REQUIRED: "true", CATALOG_HUB_API_KEY: config.CATALOG_HUB_API_KEY,
    OPENAI_API_KEY: config.OPENAI_API_KEY || process.env.OPENAI_API_KEY || "",
  });
}
launch(web, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", "3001"], process.env);
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
