import { startServer } from "./server.js";
import { error, toErrorMeta } from "./utils/logger.js";

startServer().catch((startupError) => {
  error("Node API failed to start", toErrorMeta(startupError));
  process.exit(1);
});
