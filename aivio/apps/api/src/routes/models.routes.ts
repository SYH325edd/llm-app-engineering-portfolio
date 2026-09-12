import { Router } from "express";
import { modelRegistryService } from "../services/model-registry.service.js";
import { fail, ok } from "../utils/response.js";

export const modelsRoutes = Router();

function getErrorStatus(error: unknown): number {
  const status = (error as { status?: unknown }).status;
  if (typeof status === "number" && status >= 400 && status < 600) return status;
  return 500;
}

modelsRoutes.get("/models", async (_req, res) => {
  try {
    ok(res, { models: await modelRegistryService.getPublicModels() });
  } catch (error) {
    fail(res, getErrorStatus(error), error instanceof Error ? error.message : String(error));
  }
});

modelsRoutes.get("/providers", async (_req, res) => {
  try {
    ok(res, { providers: await modelRegistryService.getPublicProviders() });
  } catch (error) {
    fail(res, getErrorStatus(error), error instanceof Error ? error.message : String(error));
  }
});

modelsRoutes.get("/video/providers", async (_req, res) => {
  try {
    ok(res, {
      providers: await modelRegistryService.getPublicVideoProviders(),
      createEndpoint: "/api/video/generations",
      taskEndpoint: "/api/video/tasks"
    });
  } catch (error) {
    fail(res, getErrorStatus(error), error instanceof Error ? error.message : String(error));
  }
});
