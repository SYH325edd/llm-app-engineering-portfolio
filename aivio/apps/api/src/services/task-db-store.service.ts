import { prisma } from "./database.service.js";
import { createId } from "../utils/id.js";
import type { CreateGenerationTaskInput, GenerationTask, GenerationTaskStatus } from "../types/generation.js";

type DbGenerationTask = {
  id: string;
  userId: string | null;
  provider: string;
  modelId: string;
  modelDisplayName: string;
  taskType: string;
  prompt: string;
  paramsJson: string;
  pricingBreakdownJson?: string;
  status: string;
  cost: number;
  providerTaskId: string;
  resultUrl: string;
  resultRawJson: string;
  errorMessage: string;
  createdAt: Date;
  updatedAt: Date;
};

function parseJson(value: string, fallback: unknown): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function stringifyJson(value: unknown, fallback: string): string {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return fallback;
  }
}

function toTask(task: DbGenerationTask): GenerationTask {
  return {
    id: task.id,
    userId: task.userId,
    provider: task.provider,
    modelId: task.modelId,
    modelDisplayName: task.modelDisplayName,
    taskType: task.taskType,
    prompt: task.prompt,
    params: parseJson(task.paramsJson, {}) as Record<string, unknown>,
    pricingBreakdown: parseJson(task.pricingBreakdownJson || "{}", {}) as Record<string, unknown>,
    status: task.status as GenerationTaskStatus,
    cost: task.cost,
    providerTaskId: task.providerTaskId,
    resultUrl: task.resultUrl,
    resultRaw: parseJson(task.resultRawJson, null),
    errorMessage: task.errorMessage,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString()
  };
}

function toUpdateData(changes: Partial<GenerationTask>): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (changes.provider !== undefined) data.provider = changes.provider;
  if (changes.userId !== undefined) data.userId = changes.userId;
  if (changes.modelId !== undefined) data.modelId = changes.modelId;
  if (changes.modelDisplayName !== undefined) data.modelDisplayName = changes.modelDisplayName;
  if (changes.taskType !== undefined) data.taskType = changes.taskType;
  if (changes.prompt !== undefined) data.prompt = changes.prompt;
  if (changes.params !== undefined) data.paramsJson = stringifyJson(changes.params, "{}");
  if (changes.pricingBreakdown !== undefined) data.pricingBreakdownJson = stringifyJson(changes.pricingBreakdown, "{}");
  if (changes.status !== undefined) data.status = changes.status;
  if (changes.cost !== undefined) data.cost = changes.cost;
  if (changes.providerTaskId !== undefined) data.providerTaskId = changes.providerTaskId;
  if (changes.resultUrl !== undefined) data.resultUrl = changes.resultUrl;
  if (changes.resultRaw !== undefined) data.resultRawJson = stringifyJson(changes.resultRaw, "null");
  if (changes.errorMessage !== undefined) data.errorMessage = changes.errorMessage;
  return data;
}

export class TaskDbStoreService {
  async list(userId: string): Promise<GenerationTask[]> {
    const tasks = await prisma.generationTask.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" }
    });
    return tasks.map(toTask);
  }

  async get(id: string, userId?: string): Promise<GenerationTask | undefined> {
    const task = userId
      ? await prisma.generationTask.findFirst({ where: { id, userId } })
      : await prisma.generationTask.findUnique({ where: { id } });
    return task ? toTask(task) : undefined;
  }

  async create(input: CreateGenerationTaskInput): Promise<GenerationTask> {
    const task = await prisma.generationTask.create({
      data: {
        id: createId(),
        userId: input.userId || null,
        provider: input.provider,
        modelId: input.modelId,
        modelDisplayName: input.modelDisplayName,
        taskType: input.taskType,
        prompt: input.prompt,
        paramsJson: stringifyJson(input.params, "{}"),
        pricingBreakdownJson: stringifyJson(input.pricingBreakdown || {}, "{}"),
        status: "pending",
        cost: input.cost,
        providerTaskId: "",
        resultUrl: "",
        resultRawJson: "null",
        errorMessage: ""
      }
    });
    return toTask(task);
  }

  async update(id: string, changes: Partial<GenerationTask>): Promise<GenerationTask> {
    try {
      const task = await prisma.generationTask.update({
        where: { id },
        data: toUpdateData(changes)
      });
      return toTask(task);
    } catch (error) {
      if ((error as { code?: string }).code === "P2025") {
        throw new Error(`Generation task '${id}' was not found.`);
      }
      throw error;
    }
  }
}

export const taskDbStore = new TaskDbStoreService();
