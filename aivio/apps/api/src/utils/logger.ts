function sanitize(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    return value
      .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
      .replace(/\b(sk-|ark-)[A-Za-z0-9._-]+/gi, "$1[REDACTED]")
      .replace(/(JWT_SECRET|API_KEY|PASSWORD)(=|":")([^,\s"}]+)/gi, "$1$2[REDACTED]");
  }
  if (Array.isArray(value)) return value.map(sanitize);
  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (/password|secret|apiKey|token|authorization/i.test(key)) {
        result[key] = "[REDACTED]";
      } else {
        result[key] = sanitize(item);
      }
    }
    return result;
  }
  return value;
}

function write(level: "info" | "warn" | "error", message: string, meta?: unknown): void {
  const time = new Date().toISOString();
  const line = JSON.stringify({
    time,
    level,
    message,
    ...(meta === undefined ? {} : { meta: sanitize(meta) })
  });
  if (level === "error") {
    console.error(line);
    return;
  }
  if (level === "warn") {
    console.warn(line);
    return;
  }
  console.log(line);
}

export function log(message: string, meta?: unknown): void {
  write("info", message, meta);
}

export function warn(message: string, meta?: unknown): void {
  write("warn", message, meta);
}

export function error(message: string, meta?: unknown): void {
  write("error", message, meta);
}

export function toErrorMeta(errorValue: unknown): Record<string, unknown> {
  if (errorValue instanceof Error) {
    return {
      name: errorValue.name,
      message: errorValue.message,
      status: (errorValue as { status?: unknown }).status
    };
  }
  return { error: String(errorValue) };
}
