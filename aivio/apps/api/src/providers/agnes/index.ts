import type { VideoProviderAdapter } from "../provider.interface.js";
import { createAgnesVideoTask, getAgnesVideoTask } from "./video.js";

export const agnesProvider: VideoProviderAdapter = {
  createVideoTask: createAgnesVideoTask,
  getVideoTask: getAgnesVideoTask
};
