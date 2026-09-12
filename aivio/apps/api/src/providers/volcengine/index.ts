import type { VideoProviderAdapter } from "../provider.interface.js";
import { createVolcengineVideoTask, getVolcengineVideoTask } from "./video.js";

export const volcengineProvider: VideoProviderAdapter = {
  createVideoTask: createVolcengineVideoTask,
  getVideoTask: getVolcengineVideoTask
};
