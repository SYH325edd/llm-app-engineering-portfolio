import type { Request } from "express";
import { Router } from "express";
import { requireActiveUser, requireAuth } from "../middleware/auth.middleware.js";
import { assetService } from "../services/asset.service.js";
import type { AssetType } from "../types/asset.js";
import type { AuthenticatedRequest } from "../types/auth.js";
import { fail, ok } from "../utils/response.js";

export const assetRoutes = Router();

type MultipartFile = {
  fieldName: string;
  originalName: string;
  mimeType: string;
  buffer: Buffer;
};

type MultipartResult = {
  fields: Record<string, string>;
  file?: MultipartFile;
};

function getErrorStatus(error: unknown): number {
  const status = (error as { status?: unknown }).status;
  if (typeof status === "number" && status >= 400 && status < 600) return status;
  return 500;
}

function getUser(req: AuthenticatedRequest) {
  const user = req.user;
  if (!user) {
    throw Object.assign(new Error("请先登录。"), { status: 401 });
  }
  return user;
}

function parseBoundary(contentType: string) {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  return (match?.[1] || match?.[2] || "").trim();
}

function parseContentDisposition(value: string) {
  const result: Record<string, string> = {};
  for (const part of value.split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (!rawKey || rawValue.length === 0) continue;
    const key = rawKey.trim().toLowerCase();
    const joined = rawValue.join("=").trim();
    result[key] = joined.replace(/^"|"$/g, "");
  }
  return result;
}

function splitBuffer(buffer: Buffer, separator: Buffer) {
  const parts: Buffer[] = [];
  let start = 0;
  let index = buffer.indexOf(separator, start);
  while (index !== -1) {
    parts.push(buffer.subarray(start, index));
    start = index + separator.length;
    index = buffer.indexOf(separator, start);
  }
  parts.push(buffer.subarray(start));
  return parts;
}

function stripCrlf(buffer: Buffer) {
  let start = 0;
  let end = buffer.length;
  if (buffer[start] === 13 && buffer[start + 1] === 10) start += 2;
  if (buffer[end - 2] === 13 && buffer[end - 1] === 10) end -= 2;
  return buffer.subarray(start, end);
}

function parseMultipartBody(body: Buffer, boundary: string): MultipartResult {
  const boundaryBuffer = Buffer.from(`--${boundary}`);
  const result: MultipartResult = { fields: {} };
  for (const rawPart of splitBuffer(body, boundaryBuffer)) {
    const part = stripCrlf(rawPart);
    if (!part.length || part.equals(Buffer.from("--"))) continue;
    const headerEnd = part.indexOf(Buffer.from("\r\n\r\n"));
    if (headerEnd === -1) continue;
    const headerText = part.subarray(0, headerEnd).toString("utf8");
    let content = part.subarray(headerEnd + 4);
    if (content.subarray(content.length - 2).equals(Buffer.from("\r\n"))) {
      content = content.subarray(0, content.length - 2);
    }

    const headers: Record<string, string> = {};
    for (const line of headerText.split("\r\n")) {
      const index = line.indexOf(":");
      if (index === -1) continue;
      headers[line.slice(0, index).trim().toLowerCase()] = line.slice(index + 1).trim();
    }
    const disposition = parseContentDisposition(headers["content-disposition"] || "");
    const fieldName = disposition.name || "";
    if (!fieldName) continue;

    if (disposition.filename !== undefined) {
      result.file = {
        fieldName,
        originalName: disposition.filename,
        mimeType: (headers["content-type"] || "application/octet-stream").toLowerCase(),
        buffer: content
      };
    } else {
      result.fields[fieldName] = content.toString("utf8");
    }
  }
  return result;
}

async function readRequestBody(req: Request, maxBytes: number) {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) {
      throw Object.assign(new Error("文件大小超出限制。"), { status: 413 });
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function numberField(value: string | undefined) {
  if (value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

assetRoutes.post("/assets/upload", requireAuth, requireActiveUser, async (req, res) => {
  try {
    const user = getUser(req as AuthenticatedRequest);
    const boundary = parseBoundary(String(req.headers["content-type"] || ""));
    if (!boundary) {
      fail(res, 400, "请使用 multipart/form-data 上传文件。");
      return;
    }

    const body = await readRequestBody(req, assetService.maxUploadBufferBytes());
    const form = parseMultipartBody(body, boundary);
    if (!form.file || form.file.fieldName !== "file") {
      fail(res, 400, "文件不能为空。");
      return;
    }

    const type = String(form.fields.type || "").trim() as AssetType;
    if (type !== "image" && type !== "video") {
      fail(res, 400, "type 必须是 image 或 video。");
      return;
    }

    const asset = await assetService.createAsset({
      userId: user.id,
      type,
      originalName: form.file.originalName,
      mimeType: form.file.mimeType,
      buffer: form.file.buffer,
      width: numberField(form.fields.clientWidth),
      height: numberField(form.fields.clientHeight),
      durationSeconds: numberField(form.fields.clientDuration)
    });
    ok(res, { asset }, 201);
  } catch (error) {
    fail(res, getErrorStatus(error), error instanceof Error ? error.message : String(error));
  }
});

assetRoutes.get("/assets/:assetId", requireAuth, async (req, res) => {
  try {
    const user = getUser(req as AuthenticatedRequest);
    const asset = await assetService.getAsset(req.params.assetId, user.id, user.role);
    if (!asset) {
      fail(res, 404, "无权访问该素材。");
      return;
    }
    ok(res, { asset });
  } catch (error) {
    fail(res, getErrorStatus(error), error instanceof Error ? error.message : String(error));
  }
});
