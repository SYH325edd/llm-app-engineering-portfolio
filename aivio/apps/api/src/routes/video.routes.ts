import { Router } from "express";
import { requireActiveUser, requireAuth } from "../middleware/auth.middleware.js";
import { generationService } from "../services/generation.service.js";
import { pricingService } from "../services/pricing.service.js";
import { fail, ok } from "../utils/response.js";
import type { AuthenticatedRequest } from "../types/auth.js";
import type { VideoGenerationRequest } from "../types/generation.js";
import type { VideoPricingInput } from "../services/pricing.service.js";

export const videoRoutes = Router();

function getErrorStatus(error: unknown): number {
  const status = (error as { status?: unknown }).status;
  if (typeof status === "number" && status >= 400 && status < 600) return status;
  const message = error instanceof Error ? error.message : String(error);
  if (/required|not configured|not enabled|not implemented|Missing environment variable/i.test(message)) return 400;
  return 500;
}

videoRoutes.post("/video/estimate-cost", requireAuth, requireActiveUser, async (req, res) => {
  try {
    const estimate = await pricingService.calculateVideoGenerationCost(req.body as VideoPricingInput);
    ok(res, {
      cost: estimate.cost,
      breakdown: estimate.breakdown
    });
  } catch (error) {
    fail(res, getErrorStatus(error), error instanceof Error ? error.message : String(error));
  }
});

videoRoutes.post("/video/generations", requireAuth, requireActiveUser, async (req, res) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    if (!user) {
      fail(res, 401, "Please sign in first.");
      return;
    }
    const task = await generationService.createVideoGeneration(req.body as VideoGenerationRequest, user.id);
    ok(res, {
      taskId: task.id,
      task_id: task.id,
      providerTaskId: task.providerTaskId,
      provider_task_id: task.providerTaskId,
      status: task.status,
      task
    });
  } catch (error) {
    const task = (error as { task?: unknown }).task;
    fail(res, getErrorStatus(error), error instanceof Error ? error.message : String(error), task ? { task } : undefined);
  }
});

videoRoutes.get("/video/tasks", requireAuth, async (req, res) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    if (!user) {
      fail(res, 401, "Please sign in first.");
      return;
    }
    const taskId = typeof req.query.taskId === "string" ? req.query.taskId : "";
    if (taskId) {
      const task = await generationService.getTask(taskId, user.id);
      if (!task) {
        fail(res, 404, `Generation task '${taskId}' was not found.`);
        return;
      }
      ok(res, {
        taskId: task.id,
        task_id: task.id,
        providerTaskId: task.providerTaskId,
        provider_task_id: task.providerTaskId,
        status: task.status,
        task
      });
      return;
    }
    const tasks = await generationService.listTasks(user.id);
    ok(res, { tasks });
  } catch (error) {
    fail(res, getErrorStatus(error), error instanceof Error ? error.message : String(error));
  }
});

videoRoutes.get("/video/tasks/:taskId", requireAuth, async (req, res) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    if (!user) {
      fail(res, 401, "Please sign in first.");
      return;
    }
    const task = await generationService.getTask(req.params.taskId, user.id);
    if (!task) {
      fail(res, 404, `Generation task '${req.params.taskId}' was not found.`);
      return;
    }
    ok(res, {
      taskId: task.id,
      task_id: task.id,
      providerTaskId: task.providerTaskId,
      provider_task_id: task.providerTaskId,
      status: task.status,
      task
    });
  } catch (error) {
    fail(res, getErrorStatus(error), error instanceof Error ? error.message : String(error));
  }
});
