import {
  Clock3,
  Download,
  FileImage,
  FileVideo,
  FileText,
  ImagePlus,
  RefreshCw,
  RotateCcw,
  Sparkles,
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import Button from "../components/Button";
import Card from "../components/Card";
import PageLayout from "../components/PageLayout";
import PromptViewerModal from "../components/PromptViewerModal";
import { getVideoModelCapabilities } from "../config/videoModelCapabilities";
import type { VideoModelCapability, VideoModelCapabilitySet } from "../config/videoModelCapabilities";
import { useAuth } from "../context/AuthContext";
import { ApiError } from "../lib/api";
import { uploadAsset } from "../lib/assets";
import type { UploadedAsset } from "../lib/assets";
import { rewritePrompt } from "../lib/prompt";
import { createVideoGeneration, estimateVideoCost, fetchModels, fetchTask, fetchTasks, normalizeResult, summarizeResultRaw } from "../lib/video";
import type { CostEstimate, GenerationTask, VideoModel } from "../lib/video";
import { inspirations } from "../mock/data";

type GenerationMode = "text" | "image" | "video";
type ImageInputMode = "first" | "multi" | "firstEnd" | "keyframes";
type VideoInputMode = "extension" | "edit";
type ImageSlot = "start" | "end";
type UploadedImage = {
  file: File;
  previewUrl: string;
  dimensions?: string;
  asset?: UploadedAsset;
  uploading?: boolean;
  uploadError?: string;
};
type UploadedVideo = {
  file: File;
  previewUrl: string;
  duration?: number;
  asset?: UploadedAsset;
  uploading?: boolean;
  uploadError?: string;
};

const promptPlaceholder = "请输入你想生成的视频画面，格式：[主体] + [动作] + [场景] + [镜头运动] + [光线] + [风格]";
const outputDurations = Array.from({ length: 12 }, (_, index) => index + 4);
const inputDurations = Array.from({ length: 14 }, (_, index) => index + 2);
const resolutions = ["480p", "720p", "1080p"] as const;
const counts = [1, 2, 3, 4];
const MAX_REFERENCE_FRAMES = 6;
const POLL_INTERVAL_MS = 500;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;
const CREATE_PROMPT_DRAFT_KEY = "aivio_create_prompt_draft";
const AGNES_SUPPORT_NOTE = "Agnes 支持文生视频、图生视频和多图关键帧；不支持参考视频输入。";
const AGNES_REFERENCE_VIDEO_NOTICE = "Agnes 当前不支持参考视频输入，请切换到文生视频或图生视频。";
const modeOptions: Array<{ key: GenerationMode; label: string; description: string }> = [
  { key: "text", label: "文生视频", description: "仅通过创意描述生成画面" },
  { key: "image", label: "图生视频", description: "支持图片素材参考" },
  { key: "video", label: "视频生视频", description: "根据视频素材生成" }
];
const imageModeOptions: Array<{ key: ImageInputMode; label: string; capability: VideoModelCapability }> = [
  { key: "first", label: "首帧", capability: "image_to_video_first_frame" },
  { key: "firstEnd", label: "首尾帧", capability: "image_to_video_first_last_frame" },
  { key: "multi", label: "多图", capability: "image_to_video_multi_image" },
  { key: "keyframes", label: "关键帧", capability: "image_to_video_keyframes" }
];
const videoModeOptions: Array<{ key: VideoInputMode; label: string; capability: VideoModelCapability }> = [
  { key: "extension", label: "视频续写", capability: "video_to_video_extension" },
  { key: "edit", label: "视频编辑", capability: "video_to_video_edit" }
];

function errorMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 402) return "余额不足，请充值后再生成。";
  if (error instanceof ApiError && error.message) return error.message;
  if (error instanceof TypeError) return "服务连接失败，请确认 Node API 已启动。";
  return error instanceof Error ? error.message : "生成失败，请稍后重试。";
}

function modelSupports1080(model?: VideoModel | null) {
  if (!model) return true;
  return !model.id.includes("seedance-2-0-fast") && !model.id.includes("seedance-2-0-mini");
}

function needsAudioMode(model?: VideoModel | null) {
  return Boolean(model?.id.includes("seedance-1-5-pro"));
}

function clampDuration(value: number) {
  return Math.min(15, Math.max(2, Math.round(value)));
}

function previewRatioClass(ratio: string) {
  if (ratio === "9:16") return "ratio-9-16";
  if (ratio === "1:1") return "ratio-1-1";
  return "ratio-16-9";
}

function generationModeLabel(mode: GenerationMode) {
  if (mode === "image") return "图生视频";
  if (mode === "video") return "视频生视频";
  return "文生视频";
}

function imageModeLabel(mode: ImageInputMode) {
  return imageModeOptions.find((option) => option.key === mode)?.label || "首帧";
}

function supportsCapability(capabilities: VideoModelCapabilitySet, capability: VideoModelCapability) {
  return Boolean(capabilities[capability]);
}

function getAvailableImageModes(capabilities: VideoModelCapabilitySet) {
  return imageModeOptions.filter((option) => supportsCapability(capabilities, option.capability));
}

function getAvailableVideoModes(capabilities: VideoModelCapabilitySet) {
  return videoModeOptions.filter((option) => supportsCapability(capabilities, option.capability));
}

function supportsGenerationMode(capabilities: VideoModelCapabilitySet, mode: GenerationMode) {
  if (mode === "text") return supportsCapability(capabilities, "text_to_video");
  if (mode === "image") return getAvailableImageModes(capabilities).length > 0;
  return getAvailableVideoModes(capabilities).length > 0;
}

function getFirstAvailableMode(capabilities: VideoModelCapabilitySet) {
  if (supportsGenerationMode(capabilities, "text")) return "text";
  if (supportsGenerationMode(capabilities, "image")) return "image";
  if (supportsGenerationMode(capabilities, "video")) return "video";
  return "text";
}

function uploadPurpose(slot: ImageSlot) {
  return slot === "start" ? "first_frame" : "last_frame";
}

function uploadErrorMessage(error: unknown) {
  if (error instanceof ApiError) return error.message;
  return "上传失败，请重试。";
}

function readImageDimensions(url: string) {
  return new Promise<{ width: number; height: number; dimensions: string }>((resolve) => {
    const probe = new Image();
    probe.onload = () => resolve({
      width: probe.naturalWidth,
      height: probe.naturalHeight,
      dimensions: `${probe.naturalWidth} × ${probe.naturalHeight}`
    });
    probe.onerror = () => resolve({ width: 0, height: 0, dimensions: "" });
    probe.src = url;
  });
}

function readVideoDuration(url: string) {
  return new Promise<number | null>((resolve) => {
    const probe = document.createElement("video");
    probe.preload = "metadata";
    probe.onloadedmetadata = () => resolve(Number.isFinite(probe.duration) ? Number(probe.duration.toFixed(1)) : null);
    probe.onerror = () => resolve(null);
    probe.src = url;
  });
}

function isTerminalStatus(status: string) {
  return ["succeeded", "failed", "cancelled"].includes(status);
}

function statusLabel(status: string) {
  if (status === "idle") return "待生成";
  if (status === "succeeded") return "已完成";
  if (status === "failed") return "已失败";
  if (status === "cancelled") return "已取消";
  if (status === "processing") return "生成中";
  return "排队中";
}

function formatTaskTime(value: string) {
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? "--" : time.toLocaleString("zh-CN", { hour12: false });
}

function taskResolution(task?: GenerationTask | null) {
  return String(task?.pricingBreakdown?.resolution || task?.params?.resolution || "--");
}

function taskDuration(task?: GenerationTask | null) {
  const value = task?.pricingBreakdown?.outputDuration || task?.params?.outputDuration || task?.params?.duration;
  const duration = Number(value);
  if (!Number.isFinite(duration) || duration <= 0) return "未知时长";
  return `${duration}s`;
}

function formatCny(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  return value.toFixed(2);
}

function upsertTask(tasks: GenerationTask[], task: GenerationTask) {
  const next = [task, ...tasks.filter((item) => item.id !== task.id)];
  return next.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 12);
}

function missingResultMessage(task?: GenerationTask | null) {
  const summary = summarizeResultRaw(task);
  return summary ? `任务已完成，但未返回结果地址。原始返回摘要：${summary}` : "任务已完成，但未返回结果地址。";
}


function readPromptDraft() {
  if (typeof window === "undefined") return "";
  try {
    return window.sessionStorage.getItem(CREATE_PROMPT_DRAFT_KEY) || "";
  } catch {
    return "";
  }
}

function savePromptDraft(value: string) {
  if (typeof window === "undefined") return;
  try {
    if (value) {
      window.sessionStorage.setItem(CREATE_PROMPT_DRAFT_KEY, value);
    } else {
      window.sessionStorage.removeItem(CREATE_PROMPT_DRAFT_KEY);
    }
  } catch {
    // Ignore storage errors so prompt editing never blocks generation.
  }
}

export default function CreatePage() {
  const navigate = useNavigate();
  const startImageInputRef = useRef<HTMLInputElement | null>(null);
  const endImageInputRef = useRef<HTMLInputElement | null>(null);
  const referenceFrameInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const pollStartedAtRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const { balance, refreshBalance, refreshCreditLogs } = useAuth();
  const [models, setModels] = useState<VideoModel[]>([]);
  const [modelId, setModelId] = useState("");
  const [prompt, setPrompt] = useState(() => readPromptDraft());
  const [ratio, setRatio] = useState("16:9");
  const [generationMode, setGenerationMode] = useState<GenerationMode>("text");
  const [imageInputMode, setImageInputMode] = useState<ImageInputMode>("first");
  const [videoInputMode, setVideoInputMode] = useState<VideoInputMode>("extension");
  const [outputDuration, setOutputDuration] = useState(0);
  const [inputVideoDuration, setInputVideoDuration] = useState(4);
  const [resolution, setResolution] = useState("720p");
  const [audioMode, setAudioMode] = useState<"audio" | "silent" | "default">("silent");
  const [motionStrength, setMotionStrength] = useState("medium");
  const [count, setCount] = useState(1);
  const [startImage, setStartImage] = useState<UploadedImage | null>(null);
  const [endImage, setEndImage] = useState<UploadedImage | null>(null);
  const [referenceFrames, setReferenceFrames] = useState<UploadedImage[]>([]);
  const [referenceVideo, setReferenceVideo] = useState<UploadedVideo | null>(null);
  const [activeTaskId, setActiveTaskId] = useState("");
  const [taskRecords, setTaskRecords] = useState<GenerationTask[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [inspirationOffset, setInspirationOffset] = useState(0);
  const [promptModalTask, setPromptModalTask] = useState<GenerationTask | null>(null);
  const [previewReferenceFrame, setPreviewReferenceFrame] = useState<UploadedImage | null>(null);
  const [advancedParamsOpen, setAdvancedParamsOpen] = useState(false);
  const [estimate, setEstimate] = useState<CostEstimate | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [loadingModels, setLoadingModels] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [isRewriting, setIsRewriting] = useState(false);
  const [rewriteError, setRewriteError] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [estimateError, setEstimateError] = useState("");

  const inputContainsVideo = generationMode === "video";
  const selectedModel = useMemo(() => models.find((model) => model.id === modelId), [models, modelId]);
  const selectedModelCapabilities = useMemo(() => getVideoModelCapabilities(selectedModel), [selectedModel]);
  const availableImageModes = useMemo(() => getAvailableImageModes(selectedModelCapabilities), [selectedModelCapabilities]);
  const availableVideoModes = useMemo(() => getAvailableVideoModes(selectedModelCapabilities), [selectedModelCapabilities]);
  const isAgnesModel = selectedModel?.provider === "agnes";
  const agnesReferenceVideoBlocked = isAgnesModel && generationMode === "video";
  const supports1080 = modelSupports1080(selectedModel);
  const showAudioMode = needsAudioMode(selectedModel);
  const estimateCost = estimate?.cost ?? 0;
  const estimateCny = formatCny(estimate?.breakdown.totalCny);
  const outputDurationLabel = outputDuration > 0 ? `${outputDuration}s` : "0s";
  const insufficient = typeof balance === "number" && estimateCost > 0 && balance < estimateCost;
  const uploadingAssets = Boolean(startImage?.uploading || endImage?.uploading || referenceVideo?.uploading || referenceFrames.some((frame) => frame.uploading));
  const selectedTask = useMemo(() => taskRecords.find((task) => task.id === selectedTaskId) || null, [selectedTaskId, taskRecords]);
  const selectedResult = useMemo(() => normalizeResult(selectedTask), [selectedTask]);
  const visibleInspirations = useMemo(() => {
    if (inspirations.length === 0) return [];
    const offset = inspirationOffset % inspirations.length;
    return [...inspirations.slice(offset), ...inspirations.slice(0, offset)];
  }, [inspirationOffset]);
  const previewStatus = selectedTask?.status || (activeTaskId ? "processing" : "idle");
  const isTaskPreviewActive = Boolean(selectedTask || activeTaskId);
  const reusablePrompt = prompt.trim() || selectedTask?.prompt?.trim() || "";
  const previewMedia =
    selectedResult
      ? { kind: selectedResult.kind, url: selectedResult.url }
      : !isTaskPreviewActive && generationMode === "video" && referenceVideo
      ? { kind: "video" as const, url: referenceVideo.previewUrl }
      : !isTaskPreviewActive && generationMode === "image" && startImage
        ? { kind: "image" as const, url: startImage.previewUrl }
        : null;
  const generateDisabledReason = submitting
    ? "当前任务正在提交，请稍候。"
    : uploadingAssets
      ? "素材仍在上传中，请等待上传完成后再生成。"
      : !modelId
        ? (loadingModels ? "模型列表加载中，请稍候。" : "请先选择可用模型。")
        : !supportsGenerationMode(selectedModelCapabilities, generationMode)
          ? "当前模型不支持所选生成模式。"
        : insufficient
          ? "当前余额不足，充值后再生成。"
          : "";

  useEffect(() => {
    savePromptDraft(prompt);
  }, [prompt]);

  useEffect(() => {
    let alive = true;
    setLoadingModels(true);
    fetchModels()
      .then((items) => {
        if (!alive) return;
        setModels(items);
        setModelId(items[0]?.id || "");
      })
      .catch((loadError) => {
        if (alive) setError(loadError instanceof TypeError ? "服务连接失败，请确认 Node API 已启动。" : "模型列表加载失败，请稍后重试。");
      })
      .finally(() => {
        if (alive) setLoadingModels(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => () => {
    abortControllerRef.current?.abort();
  }, []);

  useEffect(() => {
    let alive = true;
    fetchTasks()
      .then((items) => {
        if (!alive) return;
        setTaskRecords(items.slice(0, 12));
        const latestSuccess = items.find((task) => task.status === "succeeded" && normalizeResult(task));
        if (latestSuccess) setSelectedTaskId(latestSuccess.id);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => () => {
    if (startImage?.previewUrl) URL.revokeObjectURL(startImage.previewUrl);
  }, [startImage?.previewUrl]);

  useEffect(() => () => {
    if (endImage?.previewUrl) URL.revokeObjectURL(endImage.previewUrl);
  }, [endImage?.previewUrl]);

  useEffect(() => () => {
    if (referenceVideo?.previewUrl) URL.revokeObjectURL(referenceVideo.previewUrl);
  }, [referenceVideo?.previewUrl]);

  useEffect(() => {
    if (!modelId) return;
    const imageCapability = imageModeOptions.find((option) => option.key === imageInputMode)?.capability;
    const videoCapability = videoModeOptions.find((option) => option.key === videoInputMode)?.capability;
    const nextImageMode = imageCapability && supportsCapability(selectedModelCapabilities, imageCapability)
      ? imageInputMode
      : availableImageModes[0]?.key || "first";
    const nextVideoMode = videoCapability && supportsCapability(selectedModelCapabilities, videoCapability)
      ? videoInputMode
      : availableVideoModes[0]?.key || "extension";
    const nextGenerationMode = supportsGenerationMode(selectedModelCapabilities, generationMode)
      ? generationMode
      : getFirstAvailableMode(selectedModelCapabilities);

    if (nextImageMode !== imageInputMode) setImageInputMode(nextImageMode);
    if (nextVideoMode !== videoInputMode) setVideoInputMode(nextVideoMode);
    if (nextGenerationMode !== generationMode) {
      setGenerationMode(nextGenerationMode);
      setError("");
      setMessage("");
    }
  }, [modelId, selectedModelCapabilities, availableImageModes, availableVideoModes, generationMode, imageInputMode, videoInputMode]);

  useEffect(() => {
    if (!supports1080 && resolution === "1080p") {
      setResolution("720p");
      setEstimateError("当前模型不支持 1080p。");
    }
  }, [supports1080, resolution]);

  useEffect(() => {
    if (!showAudioMode) setAudioMode("default");
    if (showAudioMode && audioMode === "default") setAudioMode("silent");
  }, [showAudioMode, audioMode]);

  useEffect(() => {
    if (!modelId) {
      setEstimate(null);
      return;
    }
    if (outputDuration === 0) {
      setEstimate(null);
      setEstimating(false);
      setEstimateError("请选择输出时长");
      return;
    }
    let alive = true;
    setEstimating(true);
    setEstimateError("");
    estimateVideoCost({
      modelId,
      inputContainsVideo,
      inputVideoDuration: inputContainsVideo ? inputVideoDuration : undefined,
      outputDuration,
      resolution,
      audioMode: showAudioMode ? audioMode : "default",
      count
    })
      .then((result) => {
        if (!alive) return;
        setEstimate(result);
      })
      .catch((estimateLoadError) => {
        if (!alive) return;
        setEstimate(null);
        setEstimateError(errorMessage(estimateLoadError));
      })
      .finally(() => {
        if (alive) setEstimating(false);
      });
    return () => {
      alive = false;
    };
  }, [modelId, inputContainsVideo, inputVideoDuration, outputDuration, resolution, audioMode, count, showAudioMode]);

  useEffect(() => {
    if (!activeTaskId) return;
    let cancelled = false;

    async function pollTask() {
      if (Date.now() - pollStartedAtRef.current > POLL_TIMEOUT_MS) {
        setActiveTaskId("");
        setMessage("");
        setError("生成等待超过 5 分钟，已停止自动轮询。请稍后在生成记录或我的任务中刷新查看。");
        return;
      }
      try {
        const task = await fetchTask(activeTaskId);
        if (cancelled) return;
        applyTaskState(task);
        if (task.status === "succeeded" || isTerminalStatus(task.status)) {
          setActiveTaskId("");
          await Promise.all([refreshBalance(), refreshCreditLogs()]);
        }
      } catch (pollError) {
        if (!cancelled) {
          setMessage("");
          setError(errorMessage(pollError));
        }
      }
    }

    pollTask();
    const timer = window.setInterval(pollTask, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeTaskId, refreshBalance, refreshCreditLogs]);

  async function selectImageFile(slot: ImageSlot, file?: File | null) {
    if (!file) return;
    if (file.type && !["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setError("请上传 JPG / PNG / WEBP 图片。");
      return;
    }

    const previewUrl = URL.createObjectURL(file);
    const nextImage: UploadedImage = { file, previewUrl, uploading: true };
    if (slot === "start") setStartImage(nextImage);
    if (slot === "end") setEndImage(nextImage);
    setError("");
    setMessage("");

    try {
      const dimensions = await readImageDimensions(previewUrl);
      if (slot === "start") {
        setStartImage((current) => (current?.previewUrl === previewUrl ? { ...current, dimensions: dimensions.dimensions } : current));
      } else {
        setEndImage((current) => (current?.previewUrl === previewUrl ? { ...current, dimensions: dimensions.dimensions } : current));
      }
      const asset = await uploadAsset({
        file,
        type: "image",
        purpose: uploadPurpose(slot),
        clientWidth: dimensions.width || null,
        clientHeight: dimensions.height || null
      });
      const nextDimensions = asset.width && asset.height ? `${asset.width} × ${asset.height}` : dimensions.dimensions;
      if (slot === "start") {
        setStartImage((current) => (current?.previewUrl === previewUrl ? { ...current, asset, dimensions: nextDimensions, uploading: false, uploadError: "" } : current));
      } else {
        setEndImage((current) => (current?.previewUrl === previewUrl ? { ...current, asset, dimensions: nextDimensions, uploading: false, uploadError: "" } : current));
      }
    } catch (uploadError) {
      const message = uploadErrorMessage(uploadError);
      if (slot === "start") {
        setStartImage((current) => (current?.previewUrl === previewUrl ? { ...current, uploading: false, uploadError: message } : current));
      } else {
        setEndImage((current) => (current?.previewUrl === previewUrl ? { ...current, uploading: false, uploadError: message } : current));
      }
      setError(message);
    }
  }

  async function uploadReferenceFrame(file: File, previewUrl: string) {
    try {
      const dimensions = await readImageDimensions(previewUrl);
      setReferenceFrames((current) => current.map((frame) => (
        frame.previewUrl === previewUrl ? { ...frame, dimensions: dimensions.dimensions } : frame
      )));
      const asset = await uploadAsset({
        file,
        type: "image",
        purpose: "reference_frame",
        clientWidth: dimensions.width || null,
        clientHeight: dimensions.height || null
      });
      const nextDimensions = asset.width && asset.height ? `${asset.width} × ${asset.height}` : dimensions.dimensions;
      setReferenceFrames((current) => current.map((frame) => (
        frame.previewUrl === previewUrl ? { ...frame, asset, dimensions: nextDimensions, uploading: false, uploadError: "" } : frame
      )));
    } catch (uploadError) {
      const message = uploadErrorMessage(uploadError);
      setReferenceFrames((current) => current.map((frame) => (
        frame.previewUrl === previewUrl ? { ...frame, uploading: false, uploadError: message } : frame
      )));
      setError(message);
    }
  }

  function selectReferenceFrameFiles(files?: FileList | File[] | null) {
    const nextFiles = Array.from(files || []);
    if (nextFiles.length === 0) return;
    if (referenceFrames.length + nextFiles.length > MAX_REFERENCE_FRAMES) {
      setError("参考帧最多上传 6 张");
      return;
    }
    const imageFiles = nextFiles.filter((file) => !file.type || ["image/png", "image/jpeg", "image/webp"].includes(file.type));
    if (imageFiles.length !== nextFiles.length) {
      setError("请上传 JPG / PNG / WEBP 图片。");
      return;
    }

    const pendingFrames = imageFiles.map((file) => ({
      file,
      previewUrl: URL.createObjectURL(file),
      uploading: true
    }));
    setReferenceFrames((current) => [...current, ...pendingFrames].slice(0, MAX_REFERENCE_FRAMES));
    setError("");
    setMessage("");
    pendingFrames.forEach((frame) => {
      void uploadReferenceFrame(frame.file, frame.previewUrl);
    });
  }

  function replaceReferenceFrame(index: number, file?: File | null) {
    if (!file) return;
    if (file.type && !["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setError("请上传 JPG / PNG / WEBP 图片。");
      return;
    }
    const previewUrl = URL.createObjectURL(file);
    setReferenceFrames((current) => current.map((frame, frameIndex) => (
      frameIndex === index ? { file, previewUrl, uploading: true } : frame
    )));
    setPreviewReferenceFrame(null);
    setError("");
    setMessage("");
    void uploadReferenceFrame(file, previewUrl);
  }

  async function selectReferenceVideo(file?: File | null) {
    if (!file) return;
    if (!supportsGenerationMode(selectedModelCapabilities, "video")) {
      setError(isAgnesModel ? AGNES_REFERENCE_VIDEO_NOTICE : "当前模型不支持视频生视频。");
      setMessage("");
      return;
    }
    if (file.type && !["video/mp4", "video/quicktime", "video/webm"].includes(file.type)) {
      setError("请上传 MP4 / MOV / WEBM 视频。");
      return;
    }

    const previewUrl = URL.createObjectURL(file);
    setReferenceVideo({ file, previewUrl, uploading: true });
    setError("");
    setMessage("");

    try {
      const duration = await readVideoDuration(previewUrl);
      if (duration !== null) {
        setReferenceVideo((current) => (current?.previewUrl === previewUrl ? { ...current, duration } : current));
        setInputVideoDuration(clampDuration(duration));
      }
      const asset = await uploadAsset({
        file,
        type: "video",
        purpose: "reference_video",
        clientDuration: duration
      });
      const nextDuration = typeof asset.durationSeconds === "number" ? asset.durationSeconds : duration ?? undefined;
      if (typeof nextDuration === "number") setInputVideoDuration(clampDuration(nextDuration));
      setReferenceVideo((current) => (current?.previewUrl === previewUrl ? { ...current, asset, duration: nextDuration, uploading: false, uploadError: "" } : current));
    } catch (uploadError) {
      const message = uploadErrorMessage(uploadError);
      setReferenceVideo((current) => (current?.previewUrl === previewUrl ? { ...current, uploading: false, uploadError: message } : current));
      setError(message);
    }
  }

  function handleImageDrop(event: DragEvent<HTMLButtonElement>, slot: ImageSlot) {
    event.preventDefault();
    selectImageFile(slot, event.dataTransfer.files?.[0]);
  }

  function handleReferenceFrameDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    selectReferenceFrameFiles(event.dataTransfer.files);
  }

  function handleVideoDrop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    selectReferenceVideo(event.dataTransfer.files?.[0]);
  }

  function clearImage(slot: ImageSlot) {
    if (slot === "start") {
      setStartImage(null);
      if (startImageInputRef.current) startImageInputRef.current.value = "";
    } else {
      setEndImage(null);
      if (endImageInputRef.current) endImageInputRef.current.value = "";
    }
  }

  function clearReferenceVideo() {
    setReferenceVideo(null);
    if (videoInputRef.current) videoInputRef.current.value = "";
  }

  function clearReferenceFrame(index: number) {
    const removing = referenceFrames[index];
    if (removing && previewReferenceFrame?.previewUrl === removing.previewUrl) setPreviewReferenceFrame(null);
    setReferenceFrames((current) => current.filter((_, frameIndex) => frameIndex !== index));
  }

  function clearFeedback() {
    setError("");
    setMessage("");
    setRewriteError("");
    setEstimateError("");
  }

  function resetPreviewState() {
    setSelectedTaskId("");
    setActiveTaskId("");
    setPromptModalTask(null);
    setPreviewReferenceFrame(null);
  }


  function applyTaskState(task: GenerationTask) {
    const result = normalizeResult(task);
    setTaskRecords((current) => upsertTask(current, task));
    setSelectedTaskId(task.id);
    if (task.status === "succeeded" && result) {
      setError("");
      setMessage("生成完成，结果已显示在左侧预览区。");
      return;
    }
    if (task.status === "succeeded") {
      setMessage("");
      setError(missingResultMessage(task));
      return;
    }
    if (task.status === "failed" || task.status === "cancelled") {
      setMessage("");
      setError(task.errorMessage || "生成失败，请稍后重试。");
      return;
    }
    setError("");
    setMessage("任务已提交，正在等待生成结果。");
  }

  async function selectTaskForPreview(task: GenerationTask) {
    setSelectedTaskId(task.id);
    setError("");
    setMessage("");
    try {
      applyTaskState(await fetchTask(task.id));
    } catch {
      applyTaskState(task);
    }
  }
  async function handlePromptOptimize() {
    setError("");
    setRewriteError("");
    setMessage("");
    if (!prompt.trim()) {
      setError("请先输入创意描述");
      return;
    }
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setIsRewriting(true);
    try {
      const rewrittenPrompt = await rewritePrompt({
        prompt,
        duration: outputDuration > 0 ? outputDuration : undefined,
        generationMode,
        ratio,
        resolution
      }, { signal: controller.signal });
      if (!rewrittenPrompt.trim()) throw new Error("优化错误，请重试");
      setPrompt(rewrittenPrompt);
    } catch (rewriteError) {
      if (rewriteError instanceof DOMException && rewriteError.name === "AbortError") return;
      setRewriteError("优化错误，请重试");
    } finally {
      if (abortControllerRef.current === controller) abortControllerRef.current = null;
      setIsRewriting(false);
    }
  }

  function handleCancelRewrite() {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsRewriting(false);
  }

  async function handleRegenerate() {
    if (!reusablePrompt) {
      setMessage("");
      setError("请先生成一次或填写创意描述后再重新生成。");
      return;
    }
    if (!prompt.trim() && selectedTask?.prompt?.trim()) {
      setPrompt(selectedTask.prompt);
    }
    await handleSubmit(reusablePrompt);
  }

  function handleReset() {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsRewriting(false);
    setPrompt("");
    clearFeedback();
    resetPreviewState();
  }

  function handleRefreshInspirations() {
    if (inspirations.length <= 1) {
      setError("");
      setMessage("当前只有这一组创意灵感可用。");
      return;
    }
    clearFeedback();
    setInspirationOffset((current) => (current + 1) % inspirations.length);
    setMessage("已切换一组创意灵感。");
  }

  function handleUseInspiration(text: string) {
    setPrompt(text);
    setError("");
    setMessage("灵感内容已填入创意描述，可直接生成。");
  }

  function renderImageUploader(slot: ImageSlot, title: string, image: UploadedImage | null, inputRef: { current: HTMLInputElement | null }) {
    return (
      <div className="asset-upload-card">
        <div className="asset-upload-title">
          <span>{title}</span>
          {image ? <button type="button" onClick={() => inputRef.current?.click()}>替换</button> : null}
        </div>
        <input
          accept="image/png,image/jpeg,image/webp"
          className="hidden-file-input"
          ref={inputRef}
          type="file"
          onChange={(event) => {
            selectImageFile(slot, event.target.files?.[0]);
            event.currentTarget.value = "";
          }}
        />
        {image ? (
          <div className="asset-preview-row">
            <img alt={title} src={image.previewUrl} />
            <div className="asset-preview-info">
              <strong title={image.file.name}>{image.file.name}</strong>
              <span>{image.uploading ? "上传中..." : image.uploadError || image.dimensions || "上传成功"}</span>
              <div className="reference-actions">
                <button type="button" onClick={() => inputRef.current?.click()}>替换</button>
                <button className="danger" type="button" onClick={() => clearImage(slot)}><X size={13} /> 删除</button>
              </div>
            </div>
          </div>
        ) : (
          <button
            className="asset-dropzone"
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => handleImageDrop(event, slot)}
          >
            <ImagePlus size={22} />
            <strong>点击上传或拖拽图片到此处</strong>
            <span>支持 JPG / PNG / WEBP</span>
          </button>
        )}
      </div>
    );
  }

  function renderReferenceFramesUploader() {
    return (
      <div className="reference-frame-section">
        <div className="asset-upload-card">
          <div className="asset-upload-title reference-frame-title">
            <div>
              <span>参考帧</span>
              <small>参考风格、主体和构图，最多6张</small>
            </div>
            <small>{referenceFrames.length >= MAX_REFERENCE_FRAMES ? "参考帧最多 6 张" : `${referenceFrames.length}/${MAX_REFERENCE_FRAMES}`}</small>
          </div>
          <input
            accept="image/png,image/jpeg,image/webp"
            className="hidden-file-input"
            multiple
            ref={referenceFrameInputRef}
            type="file"
            onChange={(event) => {
              selectReferenceFrameFiles(event.target.files);
              event.currentTarget.value = "";
            }}
          />
          <div className="reference-frame-grid" onDragOver={(event) => event.preventDefault()} onDrop={handleReferenceFrameDrop}>
            {referenceFrames.map((frame, index) => (
              <div className={`reference-frame-tile${frame.uploadError ? " failed" : ""}${frame.uploading ? " uploading" : ""}`} key={frame.previewUrl}>
                <img alt={`参考帧 ${index + 1}`} src={frame.previewUrl} />
                <span className="reference-frame-index">{index + 1}</span>
                {frame.uploading ? <span className="reference-frame-loading">上传中...</span> : null}
                {frame.uploadError ? <span className="reference-frame-error">{frame.uploadError}</span> : null}
                <div className="reference-frame-overlay">
                  <button type="button" onClick={() => setPreviewReferenceFrame(frame)}>预览</button>
                  <label>
                    替换
                    <input
                      accept="image/png,image/jpeg,image/webp"
                      type="file"
                      onChange={(event) => {
                        replaceReferenceFrame(index, event.target.files?.[0]);
                        event.currentTarget.value = "";
                      }}
                    />
                  </label>
                  <button className="danger" type="button" onClick={() => clearReferenceFrame(index)}>删除</button>
                </div>
              </div>
            ))}
            {referenceFrames.length < MAX_REFERENCE_FRAMES ? (
              <div className="reference-frame-add-wrap">
                <button
                  className="reference-frame-add"
                  type="button"
                  onClick={() => referenceFrameInputRef.current?.click()}
                >
                  <ImagePlus size={16} />
                  <span>+ 添加</span>
                </button>
                {referenceFrames.length === 0 ? <small>参考风格、主体和构图，最多6张</small> : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  async function handleSubmit(promptOverride?: string) {
    const nextPrompt = (promptOverride ?? prompt).trim();
    setError("");
    setMessage("");
    setActiveTaskId("");
    setSelectedTaskId("");
    if (!nextPrompt) {
      setError("请输入创意描述。");
      return;
    }
    if (!modelId) {
      setError("请选择可用模型。");
      return;
    }
    if (!supportsGenerationMode(selectedModelCapabilities, generationMode)) {
      setError("当前模型不支持所选生成模式。");
      return;
    }
    if (agnesReferenceVideoBlocked) {
      setError(AGNES_REFERENCE_VIDEO_NOTICE);
      return;
    }
    const referenceFrameAssetIds = referenceFrames
      .map((frame) => frame.asset?.id)
      .filter((id): id is string => Boolean(id))
      .slice(0, MAX_REFERENCE_FRAMES);
    const effectiveReferenceFrameAssetIds =
      generationMode === "image" && (imageInputMode === "multi" || imageInputMode === "keyframes")
        ? referenceFrameAssetIds
        : [];
    if (generationMode === "image") {
      const imageCapability = imageModeOptions.find((option) => option.key === imageInputMode)?.capability;
      if (!imageCapability || !supportsCapability(selectedModelCapabilities, imageCapability)) {
        setError("当前模型不支持所选图生视频模式。");
        return;
      }
      if (uploadingAssets) {
        setError("素材上传中，请稍候。");
        return;
      }
      if (imageInputMode === "first" && !startImage?.asset) {
        setError("请上传参考图片（首帧）。");
        return;
      }
      if (imageInputMode === "firstEnd" && (!startImage?.asset || !endImage?.asset)) {
        setError("首尾帧生成需要同时上传首帧图片和尾帧图片。");
        return;
      }
      if ((imageInputMode === "multi" || imageInputMode === "keyframes") && effectiveReferenceFrameAssetIds.length < 2) {
        setError(imageInputMode === "keyframes" ? "关键帧模式需要至少上传 2 张图片。" : "多图模式需要至少上传 2 张图片。");
        return;
      }
    }
    if (inputContainsVideo) {
      const videoCapability = videoModeOptions.find((option) => option.key === videoInputMode)?.capability;
      if (!videoCapability || !supportsCapability(selectedModelCapabilities, videoCapability)) {
        setError("当前模型不支持所选视频生视频模式。");
        return;
      }
    }
    if (inputContainsVideo && uploadingAssets) {
      setError("素材上传中，请稍候。");
      return;
    }
    if (inputContainsVideo && !referenceVideo?.asset) {
      setError("请上传参考视频。");
      return;
    }
    if (outputDuration === 0) {
      setError("请选择输出时长");
      return;
    }
    if (outputDuration < 4 || outputDuration > 15) {
      setError("输出视频时长必须在 4 到 15 秒之间。");
      return;
    }
    if (inputContainsVideo && (inputVideoDuration < 2 || inputVideoDuration > 15)) {
      setError("输入视频时长必须在 2 到 15 秒之间。");
      return;
    }
    if (resolution === "1080p" && !supports1080) {
      setError("当前模型不支持 1080p。");
      return;
    }
    if (estimateError || !estimate) {
      setError(estimateError || "请等待积分预估完成。");
      return;
    }
    if (insufficient) {
      setError("当前余额不足，充值后再生成。");
      return;
    }

    setSubmitting(true);
    try {
      const result = await createVideoGeneration({
        modelId,
        prompt: nextPrompt,
        inputType: generationMode,
        imageMode: generationMode === "image"
          ? imageInputMode === "firstEnd"
            ? "first_last_frame"
            : imageInputMode === "multi"
              ? "multi_image"
              : imageInputMode === "keyframes"
                ? "keyframes"
                : "first_frame"
          : undefined,
        firstFrameAssetId: generationMode === "image" && (imageInputMode === "first" || imageInputMode === "firstEnd") ? startImage?.asset?.id : undefined,
        lastFrameAssetId: generationMode === "image" && imageInputMode === "firstEnd" ? endImage?.asset?.id : undefined,
        referenceVideoAssetId: inputContainsVideo ? referenceVideo?.asset?.id : undefined,
        referenceFrameAssetIds: effectiveReferenceFrameAssetIds,
        ratio,
        outputDuration,
        inputContainsVideo,
        inputVideoDuration: inputContainsVideo ? inputVideoDuration : undefined,
        resolution,
        audioMode: showAudioMode ? audioMode : "default",
        motionStrength,
        count
      });
      const task = result.task;
      if (isTerminalStatus(task.status)) {
        applyTaskState(task);
      } else {
        setTaskRecords((current) => upsertTask(current, task));
        setSelectedTaskId(task.id);
        setError("");
        setMessage("任务已提交，正在等待生成结果。");
        pollStartedAtRef.current = Date.now();
        setActiveTaskId(result.taskId || task.id);
      }
      await Promise.all([refreshBalance(), refreshCreditLogs()]);
    } catch (submitError) {
      setMessage("");
      if (submitError instanceof ApiError && submitError.status === 401) {
        navigate("/login");
        return;
      }
      setError(errorMessage(submitError));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PageLayout className="create-page-content">
      <section className="page-head create-page-head">
        <div>
          <h1>AI 视频生成</h1>
          <p>选择模型、画幅和素材后实时预估积分，提交后进入统一任务队列。</p>
        </div>
      </section>

      <section className="create-workbench">
        <div className="create-preview-column">
          <Card className="preview-panel">
            <div className="card-title-row">
              <div>
                <h3>视频预览</h3>
                <p className="panel-subtitle">{generationModeLabel(generationMode)} · {ratio} · {outputDurationLabel}</p>
              </div>
              <div className="tool-row preview-actions">
                <Button variant="secondary" icon={<RefreshCw size={14} />} type="button" onClick={handleRegenerate}>重新生成</Button>
                <Button variant="secondary" icon={<RotateCcw size={14} />} type="button" onClick={handleReset}>重置</Button>
              </div>
            </div>
            <div className="preview-stage">
              <div className={`preview-canvas ${previewRatioClass(ratio)}`}>
                {previewMedia?.kind === "video" ? (
                  <video className="preview-media result-media" controls autoPlay muted playsInline src={previewMedia.url} />
                ) : previewMedia?.kind === "image" ? (
                  <a className="preview-image-link" href={previewMedia.url} target="_blank" rel="noreferrer">
                    <img alt="生成结果预览" className="preview-media result-media" src={previewMedia.url} />
                  </a>
                ) : (
                  <div className="city-scene" />
                )}
                {!selectedResult && activeTaskId ? <div className="preview-state-overlay">生成中，正在获取结果...</div> : null}
                {selectedTask?.status === "failed" ? <div className="preview-state-overlay failed">{selectedTask.errorMessage || "生成失败"}</div> : null}
                {selectedTask?.status === "succeeded" && !selectedResult ? <div className="preview-state-overlay failed">{missingResultMessage(selectedTask)}</div> : null}
                {selectedResult ? (
                  <div className="result-actions">
                    {selectedResult.kind === "image" ? <a href={selectedResult.url} target="_blank" rel="noreferrer">大图预览</a> : null}
                    <a href={selectedResult.url} download target="_blank" rel="noreferrer"><Download size={14} /> 下载</a>
                  </div>
                ) : null}
              </div>
            </div>
          </Card>

          <Card className="preview-status-card">
            <div className="card-title-row compact-row">
              <h3>生成记录</h3>
              <span className={`status-pill status-${previewStatus}`}>{statusLabel(previewStatus)}</span>
            </div>
            <div className="preview-meta-grid">
              <div><span>当前任务</span><strong>{selectedTask?.id.slice(0, 12) || "--"}</strong></div>
              <div><span>模型</span><strong>{selectedTask?.modelDisplayName || selectedModel?.displayName || "--"}</strong></div>
              <div><span>分辨率</span><strong>{taskResolution(selectedTask) || resolution}</strong></div>
              <div><span>时长</span><strong>{selectedTask ? taskDuration(selectedTask) : outputDurationLabel}</strong></div>
            </div>
            <div className="history-mini-list result-history-list">
              {taskRecords.length ? taskRecords.map((task) => {
                const result = normalizeResult(task);
                return (
                  <button className={`history-mini-item result-history-item${selectedTaskId === task.id ? " active" : ""}`} key={task.id} type="button" onClick={() => selectTaskForPreview(task)}>
                    <span className={`result-thumb ${result?.kind || "empty"}`}>{result?.kind === "image" ? <img alt="" src={result.url} /> : result?.kind === "video" ? <video muted playsInline src={result.url} /> : null}</span>
                    <div>
                      <strong>{task.modelDisplayName}</strong>
                      <small>{statusLabel(task.status)} · {formatTaskTime(task.createdAt)} · {taskResolution(task)} · {taskDuration(task)}</small>
                      {task.status === "failed" ? <small className="task-error-text">{task.errorMessage || "生成失败"}</small> : null}
                    </div>
                    <button className="mini-download prompt-view-button" type="button" aria-label="查看提示词" title="查看提示词" onClick={(event) => { event.stopPropagation(); setPromptModalTask(task); }}><FileText size={13} /></button>
                    {result ? <a className="mini-download" href={result.url} download target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}><Download size={13} /></a> : null}
                  </button>
                );
              }) : <div className="empty-state compact">暂无生成记录</div>}
            </div>
          </Card>

          <Card className="inspiration-card">
            <div className="card-title-row compact-row">
              <h3>创意灵感</h3>
              <button className="link-action" type="button" onClick={handleRefreshInspirations}><RefreshCw size={13} /> 换一换</button>
            </div>
            <div className="inspiration-grid">
              {visibleInspirations.map((item) => (
                <div className="inspiration" key={item.title}>
                  <span className={`thumb-large thumb-${item.image}`} />
                  <button type="button" aria-label={`使用${item.title}`} onClick={() => handleUseInspiration(item.text)}>+</button>
                  <strong>{item.title}</strong>
                  <p>{item.text}</p>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <Card className="create-control-column">
          <div className="control-form-stack">
            <div className="control-section prompt-card">
              <div className="section-title-row">
                <div>
                  <h3>创意描述</h3>
                </div>
                <span>{prompt.length}/1000</span>
              </div>
              <label className="textarea-field">
                <textarea
                  value={prompt}
                  maxLength={1000}
                  placeholder={promptPlaceholder}
                  onChange={(event) => setPrompt(event.target.value)}
                />
              </label>
              <div className="tool-row prompt-tools">
                <Button variant="secondary" icon={<Sparkles size={14} />} type="button" disabled={isRewriting} onClick={handlePromptOptimize}>
                  {isRewriting ? "优化中..." : "优化描述"}
                </Button>
                {isRewriting ? <Button variant="secondary" icon={<X size={14} />} type="button" onClick={handleCancelRewrite}>取消优化</Button> : null}
              </div>
              {rewriteError ? (
                <div className="prompt-rewrite-error">
                  <span>{rewriteError}</span>
                  <button type="button" onClick={handlePromptOptimize}>重试</button>
                </div>
              ) : null}
            </div>

            <div className="control-section">
              <div className="section-title-row">
                <div>
                  <h3>生成模式</h3>
                  <p>选择本次任务的输入方式。</p>
                </div>
              </div>
              <div className="mode-switch" role="tablist" aria-label="生成模式">
                {modeOptions.map((option) => {
                  const disabled = !supportsGenerationMode(selectedModelCapabilities, option.key);
                  return (
                    <button
                      className={`mode-option${generationMode === option.key ? " active" : ""}`}
                      disabled={disabled}
                      key={option.key}
                      type="button"
                      onClick={() => {
                        if (disabled) return;
                        setGenerationMode(option.key);
                        if (option.key === "image" && !availableImageModes.some((item) => item.key === imageInputMode)) {
                          setImageInputMode(availableImageModes[0]?.key || "first");
                        }
                        if (option.key === "video" && !availableVideoModes.some((item) => item.key === videoInputMode)) {
                          setVideoInputMode(availableVideoModes[0]?.key || "extension");
                        }
                        setError("");
                        setMessage("");
                      }}
                    >
                      <strong>{option.label}</strong>
                      <small>{option.description}</small>
                    </button>
                  );
                })}
              </div>
              {isAgnesModel ? <p className="hint">{AGNES_SUPPORT_NOTE}</p> : null}
            </div>

            {generationMode !== "text" ? (
              <div className="control-section material-summary-section">
                {generationMode === "image" ? (
                  <div className="submode-switch image-submode-switch" role="tablist" aria-label="图片输入方式">
                    {availableImageModes.map((option) => (
                      <button
                        className={imageInputMode === option.key ? "active" : ""}
                        key={option.key}
                        type="button"
                        onClick={() => setImageInputMode(option.key)}
                      >
                        <FileImage size={14} /> {option.label}
                      </button>
                    ))}
                  </div>
                ) : null}
                {generationMode === "video" ? (
                  <div className="submode-switch" role="tablist" aria-label="视频输入方式">
                    {availableVideoModes.map((option) => (
                      <button
                        className={videoInputMode === option.key ? "active" : ""}
                        key={option.key}
                        type="button"
                        onClick={() => setVideoInputMode(option.key)}
                      >
                        <FileVideo size={14} /> {option.label}
                      </button>
                    ))}
                  </div>
                ) : null}
                <div className="inline-material-panel">
                  <div className="inline-material-head">
                    <strong>素材</strong>
                  </div>
                  <div className="inline-material-body">
                    {generationMode === "image" ? (
                      <div className="drawer-section">
                        {imageInputMode === "first" ? (
                          renderImageUploader("start", "首帧", startImage, startImageInputRef)
                        ) : imageInputMode === "firstEnd" ? (
                          <div className="dual-upload-grid">
                            {renderImageUploader("start", "首帧", startImage, startImageInputRef)}
                            {renderImageUploader("end", "尾帧", endImage, endImageInputRef)}
                          </div>
                        ) : (
                          renderReferenceFramesUploader()
                        )}
                      </div>
                    ) : null}

                    {generationMode === "video" ? (
                      <div className="drawer-section">
                        <div className="asset-upload-card">
                          <div className="asset-upload-title">
                            <span>参考视频</span>
                            {referenceVideo ? <button type="button" onClick={() => videoInputRef.current?.click()}>替换</button> : null}
                          </div>
                          <input
                            accept="video/mp4,video/quicktime,video/webm"
                            className="hidden-file-input"
                            ref={videoInputRef}
                            type="file"
                            onChange={(event) => {
                              selectReferenceVideo(event.target.files?.[0]);
                              event.currentTarget.value = "";
                            }}
                          />
                          {referenceVideo ? (
                            <div className="asset-preview-row video-asset-row">
                              <video muted playsInline src={referenceVideo.previewUrl} />
                              <div className="asset-preview-info">
                                <strong title={referenceVideo.file.name}>{referenceVideo.file.name}</strong>
                                <span>{referenceVideo.uploading ? "上传中..." : referenceVideo.uploadError || (referenceVideo.duration ? `${referenceVideo.duration.toFixed(1)}s` : "已上传")}</span>
                                <div className="reference-actions">
                                  <button type="button" onClick={() => videoInputRef.current?.click()}>替换</button>
                                  <button className="danger" type="button" onClick={clearReferenceVideo}><X size={13} /> 删除</button>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <button
                              className="asset-dropzone video-dropzone"
                              type="button"
                              onClick={() => videoInputRef.current?.click()}
                              onDragOver={(event) => event.preventDefault()}
                              onDrop={handleVideoDrop}
                            >
                              <FileVideo size={23} />
                              <strong>上传参考视频</strong>
                              <span>MP4 / MOV / WEBM</span>
                            </button>
                          )}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}

            <div className="control-section settings-section">
              <div className="settings-grid basic-settings-grid">
                <label className="setting-field full">
                  <span>模型</span>
                  <select value={modelId} onChange={(event) => setModelId(event.target.value)} disabled={loadingModels || models.length === 0}>
                    {models.map((model) => <option value={model.id} key={model.id}>{model.displayName}</option>)}
                  </select>
                </label>
                <label className="setting-field">
                  <span>分辨率</span>
                  <select value={resolution} onChange={(event) => setResolution(event.target.value)}>
                    {resolutions.map((item) => <option value={item} disabled={item === "1080p" && !supports1080} key={item}>{item}{item === "1080p" && !supports1080 ? "（当前模型不支持）" : ""}</option>)}
                  </select>
                  {!supports1080 ? <small>当前模型不支持 1080p。</small> : null}
                </label>
                <label className="setting-field">
                  <span>时长</span>
                  <select value={outputDuration} onChange={(event) => setOutputDuration(Number(event.target.value))}>
                    <option value={0} disabled hidden>0s</option>
                    {outputDurations.map((item) => <option value={item} key={item}>{item}s</option>)}
                  </select>
                </label>
                <label className="setting-field">
                  <span>比例</span>
                  <select value={ratio} onChange={(event) => setRatio(event.target.value)}>
                    <option>16:9</option>
                    <option>9:16</option>
                    <option>1:1</option>
                  </select>
                </label>
              </div>
              <button className="advanced-toggle" type="button" onClick={() => setAdvancedParamsOpen((open) => !open)}>
                高级参数
                <span>{advancedParamsOpen ? "收起" : "展开"}</span>
              </button>
              {advancedParamsOpen ? (
                <div className="settings-grid advanced-settings-grid">
                  <label className="setting-field">
                    <span>生成数量</span>
                    <select value={count} onChange={(event) => setCount(Number(event.target.value))}>
                      {counts.map((item) => <option value={item} key={item}>{item}</option>)}
                    </select>
                  </label>
                  {showAudioMode ? (
                    <label className="setting-field">
                      <span>声音模式</span>
                      <select value={audioMode} onChange={(event) => setAudioMode(event.target.value as "audio" | "silent")}>
                        <option value="audio">有声视频</option>
                        <option value="silent">无声视频</option>
                      </select>
                    </label>
                  ) : (
                    <label className="setting-field muted-field">
                      <span>声音模式</span>
                      <strong>自动匹配</strong>
                    </label>
                  )}
                  <label className="setting-field">
                    <span>运动强度</span>
                    <select value={motionStrength} onChange={(event) => setMotionStrength(event.target.value)}>
                      <option value="low">低</option>
                      <option value="medium">中</option>
                      <option value="high">高</option>
                    </select>
                  </label>
                  {inputContainsVideo ? (
                    <label className="setting-field">
                      <span>输入视频时长</span>
                      <select value={inputVideoDuration} onChange={(event) => setInputVideoDuration(Number(event.target.value))}>
                        {inputDurations.map((item) => <option value={item} key={item}>{item}s</option>)}
                      </select>
                    </label>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>

          <div className="create-action-sticky">
            <div className={`estimate-card create-estimate-card${insufficient ? " warning" : ""}`}>
              <div className="estimate-copy">
                <div className="estimate-head">
                  <span>预计消耗</span>
                </div>
                <small>根据当前模型、分辨率、时长和数量实时估算</small>
                <div className="estimate-details">
                  <b>{selectedModel?.displayName || "--"}</b>
                  <b>{resolution}</b>
                  <b>{outputDurationLabel}</b>
                  <b>{count} 个</b>
                  {inputContainsVideo ? <b>输入 {inputVideoDuration}s</b> : null}
                  {showAudioMode ? <b>{audioMode === "audio" ? "有声" : "无声"}</b> : null}
                </div>
                {insufficient ? <p>当前余额不足，充值后再生成。</p> : null}
                {estimateCny ? <p>约合：{estimateCny} 元</p> : null}
              </div>
              <strong>{estimating ? "估算中..." : estimate ? `${estimate.cost} 积分` : "--"}</strong>
            </div>

            {models.length === 0 && !loadingModels ? <p className="data-error compact">暂无可用模型，请联系管理员。</p> : null}
            {estimateError ? <p className="data-error compact">{estimateError}</p> : null}
            {error ? <p className="data-error compact">{error}</p> : null}
            {message ? <p className="auth-message success">{message}</p> : null}
            {generateDisabledReason ? <p className="hint">{generateDisabledReason}</p> : null}
            <Button className="generate-btn" type="button" disabled={Boolean(generateDisabledReason)} onClick={() => void handleSubmit()}>
              {submitting ? "提交中..." : `立即生成 · 消耗 ${estimateCost || "--"} 积分`}
            </Button>
            <p className="hint"><Clock3 size={13} /> 预计生成时间约 2 分钟，生成的视频将保存到 <Link to="/tasks">我的任务</Link> 中。</p>
          </div>
        </Card>
      </section>
      {promptModalTask ? (
        <PromptViewerModal
          title="完整提示词"
          prompt={promptModalTask.prompt}
          onClose={() => setPromptModalTask(null)}
        />
      ) : null}
      {previewReferenceFrame ? (
        <div className="reference-frame-preview-backdrop" role="presentation" onClick={() => setPreviewReferenceFrame(null)}>
          <section className="reference-frame-preview-modal" role="dialog" aria-modal="true" aria-label="参考帧预览" onClick={(event) => event.stopPropagation()}>
            <div className="reference-frame-preview-head">
              <strong>{previewReferenceFrame.file.name}</strong>
              <button type="button" aria-label="关闭" onClick={() => setPreviewReferenceFrame(null)}><X size={18} /></button>
            </div>
            <img alt={previewReferenceFrame.file.name} src={previewReferenceFrame.previewUrl} />
          </section>
        </div>
      ) : null}
    </PageLayout>
  );
}
