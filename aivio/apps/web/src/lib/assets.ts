import { API_BASE_URL, ApiError, getStoredToken } from "./api";

export type UploadedAsset = {
  id: string;
  type: "image" | "video";
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
  width?: number | null;
  height?: number | null;
  durationSeconds?: number | null;
  createdAt?: string;
  updatedAt?: string;
};

export type UploadAssetInput = {
  file: File;
  type: "image" | "video";
  purpose?: "first_frame" | "last_frame" | "reference_video" | "reference_frame";
  clientWidth?: number | null;
  clientHeight?: number | null;
  clientDuration?: number | null;
};

export async function uploadAsset(input: UploadAssetInput) {
  const form = new FormData();
  form.append("file", input.file);
  form.append("type", input.type);
  if (input.purpose) form.append("purpose", input.purpose);
  if (input.clientWidth) form.append("clientWidth", String(input.clientWidth));
  if (input.clientHeight) form.append("clientHeight", String(input.clientHeight));
  if (input.clientDuration) form.append("clientDuration", String(input.clientDuration));

  const token = getStoredToken();
  const response = await fetch(`${API_BASE_URL}/assets/upload`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: form
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new ApiError(data?.error || "上传失败，请重试。", response.status, data?.code);
  }
  return (data as { asset: UploadedAsset }).asset;
}

export async function fetchAsset(assetId: string) {
  const token = getStoredToken();
  const response = await fetch(`${API_BASE_URL}/assets/${assetId}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new ApiError(data?.error || "素材读取失败。", response.status, data?.code);
  }
  return (data as { asset: UploadedAsset }).asset;
}
