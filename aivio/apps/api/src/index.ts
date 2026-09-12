import express from "express";
import { env, getCorsOrigins, validateStartupEnv } from "./config/env.js";
import { uploadRoot } from "./services/asset.service.js";
import { healthRoutes } from "./routes/health.routes.js";
import { modelsRoutes } from "./routes/models.routes.js";
import { videoRoutes } from "./routes/video.routes.js";
import { chatRoutes } from "./routes/chat.routes.js";
import { authRoutes } from "./routes/auth.routes.js";
import { userRoutes } from "./routes/user.routes.js";
import { orderRoutes } from "./routes/order.routes.js";
import { adminRoutes } from "./routes/admin.routes.js";
import { assetRoutes } from "./routes/asset.routes.js";
import { promptRoutes } from "./routes/prompt.routes.js";
import { inviteRoutes } from "./routes/invite.routes.js";
import { error, log, toErrorMeta } from "./utils/logger.js";
import { errorHandler, notFoundHandler } from "./middleware/error.middleware.js";
import { applySecurityMiddleware } from "./middleware/security.middleware.js";

const app = express();
app.set("trust proxy", 1);

try {
  validateStartupEnv();
} catch (startupError) {
  error("Node API startup validation failed", toErrorMeta(startupError));
  process.exit(1);
}

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

app.listen(env.port, () => {
  log("Node API started", {
    url: `http://127.0.0.1:${env.port}`,
    NODE_ENV: env.nodeEnv,
    PORT: env.port,
    CORS_ORIGIN: env.corsOrigin || "development-localhost",
    nodeEnv: env.nodeEnv,
    port: env.port,
    trustProxy: app.get("trust proxy"),
    corsOrigins: getCorsOrigins()
  });
});
