import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { authService } from "../services/auth.service.js";
import type {
  AuthenticatedRequest,
  ChangePasswordRequest,
  LoginRequest,
  RegisterRequest,
  ResendEmailCodeRequest,
  ResetPasswordRequest,
  SendPasswordResetCodeRequest,
  VerifyEmailCodeRequest
} from "../types/auth.js";
import { fail, ok } from "../utils/response.js";

export const authRoutes = Router();

function getErrorStatus(error: unknown): number {
  const status = (error as { status?: unknown }).status;
  if (typeof status === "number" && status >= 400 && status < 600) return status;
  return 500;
}

authRoutes.post("/auth/register", async (req, res) => {
  try {
    const result = await authService.register(req.body as RegisterRequest);
    ok(res, result, 201);
  } catch (error) {
    fail(res, getErrorStatus(error), error instanceof Error ? error.message : String(error));
  }
});

authRoutes.post("/auth/login", async (req, res) => {
  try {
    const result = await authService.login(req.body as LoginRequest);
    ok(res, result);
  } catch (error) {
    fail(res, getErrorStatus(error), error instanceof Error ? error.message : String(error));
  }
});

authRoutes.post("/auth/change-password", async (req, res) => {
  try {
    const result = await authService.changePasswordByEmail(req.body as ChangePasswordRequest);
    ok(res, result);
  } catch (error) {
    fail(res, getErrorStatus(error), error instanceof Error ? error.message : String(error));
  }
});

authRoutes.post("/auth/send-password-reset-code", async (req, res) => {
  try {
    const result = await authService.sendPasswordResetCode(req.body as SendPasswordResetCodeRequest);
    ok(res, result);
  } catch (error) {
    fail(res, getErrorStatus(error), error instanceof Error ? error.message : String(error));
  }
});

authRoutes.post("/auth/reset-password", async (req, res) => {
  try {
    const result = await authService.resetPassword(req.body as ResetPasswordRequest);
    ok(res, result);
  } catch (error) {
    fail(res, getErrorStatus(error), error instanceof Error ? error.message : String(error));
  }
});

authRoutes.get("/auth/check-email", async (req, res) => {
  try {
    const result = await authService.checkEmail(String(req.query.email || ""));
    ok(res, result);
  } catch (error) {
    fail(res, getErrorStatus(error), error instanceof Error ? error.message : String(error));
  }
});

authRoutes.post("/auth/verify-email-code", async (req, res) => {
  try {
    const result = await authService.verifyEmailCode(req.body as VerifyEmailCodeRequest);
    ok(res, result);
  } catch (error) {
    fail(res, getErrorStatus(error), error instanceof Error ? error.message : String(error));
  }
});

authRoutes.post("/auth/resend-email-code", async (req, res) => {
  try {
    const result = await authService.resendEmailCode(req.body as ResendEmailCodeRequest);
    ok(res, result);
  } catch (error) {
    fail(res, getErrorStatus(error), error instanceof Error ? error.message : String(error));
  }
});

authRoutes.post("/auth/logout", (_req, res) => {
  ok(res, { ok: true });
});

authRoutes.get("/auth/me", requireAuth, (req, res) => {
  ok(res, { user: (req as AuthenticatedRequest).user });
});
