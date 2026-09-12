import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { defineConfig } from "prisma/config";

const apiRoot = process.cwd();
const repoRoot = path.resolve(apiRoot, "..", "..");
const defaultDatabaseUrl = "file:./dev.db";

if (process.env.NODE_ENV === "production") {
  dotenv.config({ path: path.join(apiRoot, ".env.production"), override: false });
}
dotenv.config({ path: path.join(apiRoot, ".env"), override: false });
dotenv.config({ path: path.join(repoRoot, ".env"), override: false });
dotenv.config({ path: path.join(apiRoot, ".env.example"), override: false });
dotenv.config({ path: path.join(repoRoot, ".env.example"), override: false });

function ensureLocalSqliteFile(databaseUrl: string): void {
  if (!databaseUrl.startsWith("file:")) return;
  const target = databaseUrl.slice("file:".length).split("?")[0].trim();
  if (!target || target === ":memory:") return;
  const sqliteFilePath = path.resolve(path.join(apiRoot, "prisma"), target);
  fs.mkdirSync(path.dirname(sqliteFilePath), { recursive: true });
  if (!fs.existsSync(sqliteFilePath)) {
    fs.closeSync(fs.openSync(sqliteFilePath, "a"));
  }
}

const databaseUrl = process.env.DATABASE_URL || defaultDatabaseUrl;
ensureLocalSqliteFile(databaseUrl);

export default defineConfig({
  schema: "prisma/schema.prisma",
  engine: "classic",
  datasource: {
    url: databaseUrl
  }
});
