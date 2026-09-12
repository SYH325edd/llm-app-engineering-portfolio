import type { VideoModel } from "../lib/video";

export type VideoModelCapability =
  | "text_to_video"
  | "image_to_video_first_frame"
  | "image_to_video_multi_image"
  | "image_to_video_first_last_frame"
  | "image_to_video_keyframes"
  | "video_to_video_extension"
  | "video_to_video_edit";

export type VideoModelCapabilitySet = Record<VideoModelCapability, boolean>;

const emptyCapabilities = (): VideoModelCapabilitySet => ({
  text_to_video: false,
  image_to_video_first_frame: false,
  image_to_video_multi_image: false,
  image_to_video_first_last_frame: false,
  image_to_video_keyframes: false,
  video_to_video_extension: false,
  video_to_video_edit: false
});

const capabilities = (items: VideoModelCapability[]): VideoModelCapabilitySet => {
  const result = emptyCapabilities();
  for (const item of items) result[item] = true;
  return result;
};

export const videoModelCapabilities: Record<string, VideoModelCapabilitySet> = {
  "agnes-video-v2.0": capabilities([
    "text_to_video",
    "image_to_video_first_frame",
    "image_to_video_multi_image",
    "image_to_video_keyframes"
  ]),
  "doubao-seedance-2-0-260128": capabilities([
    "text_to_video",
    "image_to_video_first_frame",
    "image_to_video_first_last_frame",
    "video_to_video_extension",
    "video_to_video_edit"
  ]),
  "doubao-seedance-2-0-fast-260128": capabilities([
    "text_to_video",
    "image_to_video_first_frame",
    "image_to_video_first_last_frame",
    "video_to_video_extension",
    "video_to_video_edit"
  ]),
  "doubao-seedance-1-5-pro-251215": capabilities([
    "text_to_video",
    "image_to_video_first_frame",
    "image_to_video_first_last_frame"
  ]),
  "doubao-seedance-1-0-pro-250428": capabilities([
    "text_to_video",
    "image_to_video_first_frame",
    "image_to_video_first_last_frame"
  ]),
  "ep-20260527143333-wf4ml": capabilities([
    "text_to_video",
    "image_to_video_first_frame",
    "image_to_video_first_last_frame"
  ]),
  "doubao-seedance-1-0-pro-fast-250528": capabilities([
    "text_to_video",
    "image_to_video_first_frame",
    "image_to_video_first_last_frame"
  ]),
  "doubao-seedance-1-0-lite-t2v-250219": capabilities(["text_to_video"]),
  "doubao-seedance-1-0-lite-i2v-250219": capabilities(["image_to_video_first_frame"])
};

export function getVideoModelCapabilities(model?: VideoModel | null): VideoModelCapabilitySet {
  if (!model) return emptyCapabilities();
  const configured = videoModelCapabilities[model.id];
  if (configured) return configured;

  const inputTypes = model.inputType.split(",").map((item) => item.trim());
  return capabilities([
    ...(inputTypes.includes("text") ? (["text_to_video"] as const) : []),
    ...(inputTypes.includes("image") ? (["image_to_video_first_frame"] as const) : []),
    ...(inputTypes.includes("video") ? (["video_to_video_extension"] as const) : [])
  ]);
}
