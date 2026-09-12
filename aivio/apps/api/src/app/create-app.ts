import express from "express";
import { uploadRoot } from "../modules/assets/service.js";
import { healthRoutes } from "../modules/health/index.js";
import { modelsRoutes } from "../modules/models/index.js";
import { videoRoutes } from "../modules/generation/index.js";
import { chatRoutes } from "../modules/chat/index.js";
import { authRoutes } from "../modules/auth/index.js";
import { userRoutes } from "../modules/users/index.js";
import { orderRoutes } from "../modules/billing/index.js";
import { adminRoutes } from "../modules/admin/index.js";
import { assetRoutes } from "../modules/assets/index.js";
import { promptRoutes } from "../modules/prompt/index.js";
import { inviteRoutes } from "../modules/invite/index.js";
import { errorHandler, notFoundHandler } from "../middleware/error.middleware.js";
import { applySecurityMiddleware } from "../middleware/security.middleware.js";

export async function createApp() {
  const app = express();
  app.set("trust proxy", 1);

  await applySecurityMiddleware(app);
  app.use("/uploads", express.static(uploadRoot, { dotfiles: "deny", index: false, fallthrough: false }));
  app.use(express.json({ limit: "2mb" }));

  app.use("/", healthRoutes);
  app.use("/api", healthRoutes);
  app.use("/api", authRoutes);
  app.use("/api", userRoutes);
  app.use("/api", orderRoutes);
  app.use("/api", adminRoutes);
  app.use("/api", modelsRoutes);
  app.use("/api", assetRoutes);
  app.use("/api", promptRoutes);
  app.use("/api", inviteRoutes);
  app.use("/api", videoRoutes);
  app.use("/api", chatRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
