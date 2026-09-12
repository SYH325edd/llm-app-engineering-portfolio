import fs from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env.js";
import { prisma } from "../services/database.service.js";
import type { GenerationTask } from "../types/generation.js";

function stringifyJson(value: unknown, fallback: string): string {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return fallback;
  }
}

function asDate(value: string | undefined): Date {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

async function readJsonTasks(): Promise<GenerationTask[]> {
  const jsonPath = path.join(env.repoRoot, "data", "generation-tasks.json");
  const raw = (await fs.readFile(jsonPath, "utf8")).replace(/^\uFEFF/, "");
  if (!raw.trim()) return [];
  const parsed = JSON.parse(raw) as GenerationTask[];
  if (!Array.isArray(parsed)) {
    throw new Error(`Task JSON root must be an array: ${jsonPath}`);
  }
  return parsed;
}

async function main(): Promise<void> {
  const tasks = await readJsonTasks();
  let imported = 0;
  let skipped = 0;

  for (const task of tasks) {
    const exists = await prisma.generationTask.findUnique({ where: { id: task.id } });
    if (exists) {
      skipped += 1;
      continue;
    }

    await prisma.generationTask.create({
      data: {
        id: task.id,
        userId: task.userId || null,
        provider: task.provider || "",
        modelId: task.modelId || "",
        modelDisplayName: task.modelDisplayName || "",
        taskType: task.taskType || "",
        prompt: task.prompt || "",
        paramsJson: stringifyJson(task.params || {}, "{}"),
        status: task.status || "pending",
        cost: task.cost || 0,
        providerTaskId: task.providerTaskId || "",
        resultUrl: task.resultUrl || "",
        resultRawJson: stringifyJson(task.resultRaw, "null"),
        errorMessage: task.errorMessage || "",
        createdAt: asDate(task.createdAt),
        updatedAt: asDate(task.updatedAt)
      }
    });
    imported += 1;
  }

  console.log(`JSON task migration complete. imported=${imported} skipped=${skipped}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
