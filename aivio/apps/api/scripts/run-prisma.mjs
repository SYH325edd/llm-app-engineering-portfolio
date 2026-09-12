import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(apiRoot, "..", "..");
const schemaPath = path.join(apiRoot, "prisma", "schema.prisma");
const prismaCliPath = path.join(apiRoot, "node_modules", "prisma", "build", "index.js");

if (process.env.NODE_ENV === "production") {
  dotenv.config({ path: path.join(apiRoot, ".env.production"), override: false });
}
dotenv.config({ path: path.join(apiRoot, ".env"), override: false });
dotenv.config({ path: path.join(repoRoot, ".env"), override: false });
dotenv.config({ path: path.join(apiRoot, ".env.example"), override: false });
dotenv.config({ path: path.join(repoRoot, ".env.example"), override: false });

function resolveSqliteFilePath(databaseUrl) {
  const value = String(databaseUrl || "").trim();
  if (!value.startsWith("file:")) return null;
  const target = value.slice("file:".length).split("?")[0].trim();
  if (!target || target === ":memory:") return null;
  return path.resolve(path.join(apiRoot, "prisma"), target);
}

function ensureLocalSqliteFile(databaseUrl) {
  const sqliteFilePath = resolveSqliteFilePath(databaseUrl);
  if (!sqliteFilePath) return;
  fs.mkdirSync(path.dirname(sqliteFilePath), { recursive: true });
  if (!fs.existsSync(sqliteFilePath)) {
    fs.closeSync(fs.openSync(sqliteFilePath, "a"));
  }
}

const rawArgs = process.argv.slice(2);
const args = rawArgs.includes("--schema") ? rawArgs : [...rawArgs, "--schema", schemaPath];

if (args[0] === "db" && args[1] === "push") {
  const databaseUrl = process.env.DATABASE_URL || "";
  if (!databaseUrl.trim()) {
    console.error("DATABASE_URL is not configured. Copy apps/api/.env.example to apps/api/.env or configure the repo root .env before running Prisma db push.");
    process.exit(1);
  }
  ensureLocalSqliteFile(databaseUrl);
}

const result = spawnSync(process.execPath, [prismaCliPath, ...args], {
  cwd: apiRoot,
  env: process.env,
  stdio: "inherit"
});

process.exit(result.status ?? 1);
