import type { TextResourceOutput } from "./protocol";
import { loadResource, resolveResourceUrl } from "./resourceLoader";

export const MAX_TEXT_RESOURCE_BYTES = 5 * 1024 * 1024;
export const MAX_TOTAL_TEXT_RESOURCE_BYTES = 20 * 1024 * 1024;

const TEXT_RESOURCE_SCHEMES = new Set(["http:", "https:"]);
const TEXT_MIME_TYPES = new Set([
  "application/ecmascript",
  "application/graphql-response+json",
  "application/javascript",
  "application/json",
  "application/ld+json",
  "application/manifest+json",
  "application/rss+xml",
  "application/atom+xml",
  "application/xhtml+xml",
  "application/xml",
  "application/x-javascript",
  "image/svg+xml"
]);

export function resolveTextResourceUrl(ref: string, baseUrl: string): string {
  return resolveResourceUrl(ref, baseUrl, TEXT_RESOURCE_SCHEMES, "テキスト資源");
}

export async function loadTextResource(
  url: string,
  signal?: AbortSignal
): Promise<TextResourceOutput> {
  const resource = await loadResource(url, {
    label: "テキスト資源",
    maxBytes: MAX_TEXT_RESOURCE_BYTES,
    signal
  });
  const mimeType = parseMimeType(resource.contentType);
  if (!isTextMimeType(mimeType)) {
    throw new Error(`テキストとして扱えないContent-Typeです: ${mimeType || "不明"}`);
  }

  const charset = parseCharset(resource.contentType);
  let content: string;
  try {
    content = new TextDecoder(charset).decode(resource.buffer);
  } catch {
    throw new Error(`未対応の文字コードです: ${charset}`);
  }

  return {
    type: "text_resource",
    content,
    url: resource.url,
    contentType: resource.contentType,
    byteLength: resource.byteLength
  };
}

function parseMimeType(contentType: string): string {
  return contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function isTextMimeType(mimeType: string): boolean {
  return mimeType.startsWith("text/")
    || mimeType.endsWith("+json")
    || mimeType.endsWith("+xml")
    || TEXT_MIME_TYPES.has(mimeType);
}

function parseCharset(contentType: string): string {
  const match = /(?:^|;)\s*charset\s*=\s*(?:"([^"]+)"|'([^']+)'|([^;\s]+))/i.exec(contentType);
  return (match?.[1] ?? match?.[2] ?? match?.[3] ?? "utf-8").trim();
}
