import type { TextResource } from "./protocol";

const MAX_TEXT_BYTES = 5 * 1024 * 1024;

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

/** Resolves a ref against the page URL, allowing only the given schemes. */
export function resolveUrl(ref: string, baseUrl: string, schemes: string[]): string {
  let url: URL;
  try {
    url = new URL(ref, baseUrl);
  } catch {
    throw new Error(`Could not resolve ref as a URL: ${ref}`);
  }
  if (!schemes.includes(url.protocol)) throw new Error(`Unsupported URL scheme: ${url.protocol}`);
  url.hash = "";
  return url.href;
}

export function isSameOrigin(url: string, baseUrl: string): boolean {
  return new URL(url).origin === new URL(baseUrl).origin;
}

export async function fetchBytes(url: string, maxBytes: number, signal?: AbortSignal) {
  let response: Response;
  try {
    response = await fetch(url, { signal });
  } catch (error) {
    throw new Error(`Could not fetch ${url}.${error instanceof Error && error.message ? ` ${error.message}` : ""}`);
  }
  if (!response.ok) throw new Error(`Failed to fetch ${url} (HTTP ${response.status}).`);
  const tooLarge = () => new Error(`${url} exceeds ${maxBytes / (1024 * 1024)} MiB.`);
  if (Number(response.headers.get("Content-Length")) > maxBytes) throw tooLarge();
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > maxBytes) throw tooLarge();
  return { buffer, contentType: response.headers.get("Content-Type") ?? "", url: response.url || url };
}

export async function fetchText(url: string, signal?: AbortSignal): Promise<TextResource> {
  const resource = await fetchBytes(url, MAX_TEXT_BYTES, signal);
  const mimeType = resource.contentType.split(";", 1)[0]!.trim().toLowerCase();
  if (!(mimeType.startsWith("text/") || mimeType.endsWith("+json") || mimeType.endsWith("+xml") || TEXT_MIME_TYPES.has(mimeType))) {
    throw new Error(`This Content-Type cannot be handled as text: ${mimeType || "unknown"}`);
  }
  const charset = /(?:^|;)\s*charset\s*=\s*"?([^";\s]+)/i.exec(resource.contentType)?.[1] ?? "utf-8";
  let content: string;
  try {
    content = new TextDecoder(charset).decode(resource.buffer);
  } catch {
    throw new Error(`Unsupported character encoding: ${charset}`);
  }
  return { content, url: resource.url, byteLength: resource.buffer.byteLength };
}
