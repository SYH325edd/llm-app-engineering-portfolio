import { env, getCorsOrigins, validateStartupEnv } from "./config/env.js";
import { createApp } from "./app/create-app.js";
import { error, log, toErrorMeta } from "./utils/logger.js";

export async function startServer() {
  try {
    validateStartupEnv();
  } catch (startupError) {
    error("Node API startup validation failed", toErrorMeta(startupError));
    throw startupError;
  }

  const app = await createApp();
  return app.listen(env.port, () => {
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
}
