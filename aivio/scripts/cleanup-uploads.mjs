import fs from "node:fs/promises";
import path from "node:path";

const repoRoot = process.cwd();
const envFiles = [
  path.join(repoRoot, ".env"),
  path.join(repoRoot, "apps", "api", ".env")
];
const uploadDirectories = [
  path.join(repoRoot, "uploads"),
  path.join(repoRoot, "apps", "api", "uploads")
];
const protectedNames = new Set([".gitkeep", "README", "README.md", "README.txt"]);
const sourceLikeExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".md", ".txt", ".css", ".html", ".map"]);

async function readEnvFile(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

function parseEnvValue(text, key) {
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) continue;
    const currentKey = line.slice(0, separatorIndex).trim();
    if (currentKey !== key) continue;
    return line.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, "");
  }
  return "";
}

async function resolveRetentionDays() {
  const values = [process.env.UPLOAD_RETENTION_DAYS];
  for (const envFile of envFiles) {
    values.push(parseEnvValue(await readEnvFile(envFile), "UPLOAD_RETENTION_DAYS"));
  }
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return 7;
}

function isProtectedFile(fileName) {
  return protectedNames.has(fileName);
}

function looksLikeSourceFile(fileName) {
  return sourceLikeExtensions.has(path.extname(fileName).toLowerCase());
}

async function collectFiles(directoryPath, results) {
  let entries = [];
  try {
    entries = await fs.readdir(directoryPath, { withFileTypes: true });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }

  results.scannedDirectories += 1;

  for (const entry of entries) {
    const absolutePath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(absolutePath, results);
      continue;
    }

    results.files.push({
      absolutePath,
      name: entry.name
    });
  }
}

async function cleanupUploads() {
  const retentionDays = await resolveRetentionDays();
  const cutoffTime = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const results = {
    scannedDirectories: 0,
    deletedFiles: 0,
    skippedFiles: 0,
    retentionDays,
    files: []
  };

  for (const directoryPath of uploadDirectories) {
    await collectFiles(directoryPath, results);
  }

  for (const file of results.files) {
    if (isProtectedFile(file.name)) {
      results.skippedFiles += 1;
      continue;
    }

    if (looksLikeSourceFile(file.name)) {
      results.skippedFiles += 1;
      continue;
    }

    const stats = await fs.stat(file.absolutePath);
    if (!stats.isFile()) {
      results.skippedFiles += 1;
      continue;
    }

    if (stats.mtimeMs > cutoffTime) {
      results.skippedFiles += 1;
      continue;
    }

    await fs.unlink(file.absolutePath);
    results.deletedFiles += 1;
  }

  console.log(JSON.stringify({
    scannedDirectories: results.scannedDirectories,
    deletedFiles: results.deletedFiles,
    skippedFiles: results.skippedFiles,
    retentionDays: results.retentionDays
  }, null, 2));
}

await cleanupUploads();
