import { i18n } from "./i18n.ts";

export interface LoadedResource {
  buffer: ArrayBuffer;
  byteLength: number;
  contentType: string;
  url: string;
}

interface LoadResourceOptions {
  label: string;
  maxBytes: number;
  signal?: AbortSignal;
}

export function resolveResourceUrl(
  ref: string,
  baseUrl: string,
  schemes: ReadonlySet<string>,
  label: string
): string {
  let url: URL;
  try {
    url = new URL(ref, baseUrl);
  } catch {
    throw new Error(i18n._({ id: "errors.resolveResourceUrl", message: "Could not resolve ref as a {label} URL.", values: { label } }));
  }
  if (!schemes.has(url.protocol)) {
    throw new Error(i18n._({ id: "errors.unsupportedUrlScheme", message: "Unsupported URL scheme: {scheme}", values: { scheme: url.protocol } }));
  }
  url.hash = "";
  return url.href;
}

export function isSameOrigin(url: string, baseUrl: string): boolean {
  return new URL(url).origin === new URL(baseUrl).origin;
}

export async function loadResource(
  source: string,
  { label, maxBytes, signal }: LoadResourceOptions
): Promise<LoadedResource> {
  let response: Response;
  try {
    response = await fetch(source, { signal });
  } catch (error) {
    throw new Error(i18n._({ id: "errors.fetchResource", message: "Could not fetch {label}.{cause}", values: { label, cause: formatCause(error) } }));
  }
  if (!response.ok) throw new Error(i18n._({ id: "errors.fetchResourceHttp", message: "Failed to fetch {label} (HTTP {status}).", values: { label, status: response.status } }));

  const contentLengthHeader = response.headers.get("Content-Length");
  if (contentLengthHeader !== null) {
    const contentLength = Number(contentLengthHeader);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      throw resourceTooLarge(label, maxBytes);
    }
  }

  const buffer = await readResponseBuffer(response, maxBytes, label);

  return {
    buffer,
    byteLength: buffer.byteLength,
    contentType: response.headers.get("Content-Type") ?? "",
    url: response.url || source
  };
}

async function readResponseBuffer(
  response: Response,
  maxBytes: number,
  label: string
): Promise<ArrayBuffer> {
  if (!response.body) {
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > maxBytes) {
      throw resourceTooLarge(label, maxBytes);
    }
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
    if (byteLength > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw resourceTooLarge(label, maxBytes);
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}

function formatMiB(bytes: number): string {
  return String(bytes / (1024 * 1024));
}

function resourceTooLarge(label: string, maxBytes: number): Error {
  return new Error(i18n._({
    id: "errors.resourceTooLarge",
    message: "{label} exceeds {size} MiB.",
    values: { label, size: formatMiB(maxBytes) }
  }));
}

function formatCause(error: unknown): string {
  return error instanceof Error && error.message ? ` ${error.message}` : "";
}
