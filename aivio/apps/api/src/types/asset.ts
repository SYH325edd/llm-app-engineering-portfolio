export type AssetType = "image" | "video";

export interface PublicUploadedAsset {
  id: string;
  userId?: string;
  type: AssetType;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
  publicUrl?: string;
  signedUrl?: string;
  width?: number | null;
  height?: number | null;
  durationSeconds?: number | null;
  createdAt?: string;
  updatedAt?: string;
}
