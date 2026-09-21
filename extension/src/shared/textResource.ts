import type { TextResourceOutput } from "./protocol";
import { loadResource, resolveResourceUrl } from "./resourceLoader";
import { i18n } from "./i18n.ts";

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
  return resolveResourceUrl(ref, baseUrl, TEXT_RESOURCE_SCHEMES, i18n._({ id: "resources.text", message: "text resource" }));
}

export async function loadTextResource(
  url: string,
  signal?: AbortSignal
): Promise<TextResourceOutput> {
  const resource = await loadResource(url, {
    label: i18n._({ id: "resources.text", message: "text resource" }),
    maxBytes: MAX_TEXT_RESOURCE_BYTES,
    signal
  });
  const mimeType = parseMimeType(resource.contentType);
  if (!isTextMimeType(mimeType)) {
    throw new Error(i18n._({ id: "errors.nonTextContentType", message: "This Content-Type cannot be handled as text: {mimeType}", values: { mimeType: mimeType || i18n._({ id: "common.unknown", message: "unknown" }) } }));
  }

  const charset = parseCharset(resource.contentType);
  let content: string;
  try {
    content = new TextDecoder(charset).decode(resource.buffer);
  } catch {
    throw new Error(i18n._({ id: "errors.unsupportedCharset", message: "Unsupported character encoding: {charset}", values: { charset } }));
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
