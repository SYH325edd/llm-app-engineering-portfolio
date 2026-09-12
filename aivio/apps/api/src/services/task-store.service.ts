import fs from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env.js";
import { createId } from "../utils/id.js";
import type { CreateGenerationTaskInput, GenerationTask } from "../types/generation.js";

async function ensureStore(): Promise<void> {
  await fs.mkdir(path.dirname(env.taskStorePath), { recursive: true });
  try {
    await fs.access(env.taskStorePath);
  } catch {
    await fs.writeFile(env.taskStorePath, "[]", "utf8");
  }
}

async function readTasks(): Promise<GenerationTask[]> {
  await ensureStore();
  try {
    const raw = (await fs.readFile(env.taskStorePath, "utf8")).replace(/^\uFEFF/, "");
    if (!raw.trim()) return [];
    const parsed = JSON.parse(raw) as GenerationTask[];
    if (!Array.isArray(parsed)) {
      throw new Error("Task store root must be an array.");
    }
    return parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read generation task store '${env.taskStorePath}': ${message}`);
  }
}

async function writeTasks(tasks: GenerationTask[]): Promise<void> {
  await ensureStore();
  try {
    const sorted = [...tasks].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    await fs.writeFile(env.taskStorePath, `${JSON.stringify(sorted, null, 2)}\n`, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to write generation task store '${env.taskStorePath}': ${message}`);
  }
}

export class TaskStoreService {
  async list(): Promise<GenerationTask[]> {
    return readTasks();
  }

  async get(id: string): Promise<GenerationTask | undefined> {
    const tasks = await readTasks();
    return tasks.find((task) => task.id === id);
  }

  async create(input: CreateGenerationTaskInput): Promise<GenerationTask> {
    const tasks = await readTasks();
    const now = new Date().toISOString();
    const task: GenerationTask = {
      id: createId(),
      provider: input.provider,
      modelId: input.modelId,
      modelDisplayName: input.modelDisplayName,
      taskType: input.taskType,
      prompt: input.prompt,
      params: input.params,
      pricingBreakdown: input.pricingBreakdown || {},
      status: "pending",
      cost: input.cost || 0,
      providerTaskId: "",
      resultUrl: "",
      resultRaw: null,
      errorMessage: "",
      createdAt: now,
      updatedAt: now
    };
    await writeTasks([task, ...tasks]);
    return task;
  }

  async update(id: string, changes: Partial<GenerationTask>): Promise<GenerationTask> {
    const tasks = await readTasks();
    const index = tasks.findIndex((task) => task.id === id);
    if (index === -1) {
      throw new Error(`Generation task '${id}' was not found.`);
    }

    const updated: GenerationTask = {
      ...tasks[index],
      ...changes,
      updatedAt: new Date().toISOString()
    };
    tasks[index] = updated;
    await writeTasks(tasks);
    return updated;
  }
}

export const taskStore = new TaskStoreService();
