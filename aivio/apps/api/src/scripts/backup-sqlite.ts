import fs from "node:fs";
import path from "node:path";
import { env, getEnv } from "../config/env.js";

function getSqlitePath(): string {
  const databaseUrl = getEnv("DATABASE_URL").trim();
  if (!databaseUrl.startsWith("file:")) {
    throw new Error("db:backup currently supports SQLite file: DATABASE_URL values only.");
  }
  const rawPath = databaseUrl.slice("file:".length).replace(/^"|"$/g, "");
  if (!rawPath) {
    throw new Error("DATABASE_URL does not contain a SQLite file path.");
  }
  if (path.isAbsolute(rawPath)) return rawPath;
  return path.resolve(env.apiRoot, "prisma", rawPath);
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function main(): Promise<void> {
  const source = getSqlitePath();
  if (!fs.existsSync(source)) {
    throw new Error(`SQLite database was not found at ${source}. Run npm run db:push first.`);
  }
  const backupDir = path.join(env.apiRoot, "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const target = path.join(backupDir, `sqlite-${timestamp()}.db`);
  fs.copyFileSync(source, target);
  console.log(JSON.stringify({ ok: true, source, backup: target }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
