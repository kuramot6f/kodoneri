import type { ImageToolOutput, ToolOutput, ToolSuccessOutput } from "../shared/protocol";
import { loadResource, resolveResourceUrl } from "../shared/resourceLoader";
import { i18n } from "../shared/i18n.ts";
import type { PageResourceEntry } from "./pageSnapshot";

const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
const MAX_TOTAL_TOOL_CONTENT_LENGTH = 44 * 1024 * 1024;
const IMAGE_RESOURCE_SCHEMES = new Set(["data:", "blob:", "http:", "https:"]);

interface ReadTarget {
  cacheKey: string;
  load: () => Promise<ToolSuccessOutput>;
}

export function createImageReader(
  baseUrl: string,
  getResources: () => ReadonlyMap<string, PageResourceEntry>
): (argumentsJson: string) => Promise<ToolOutput> {
  const cache = new Map<string, Promise<ToolSuccessOutput>>();
  let returnedContentLength = 0;

  return async (argumentsJson) => {
    try {
      const ref = parseReadImageArgs(argumentsJson);
      const target = resolveReadTarget(ref, baseUrl, getResources());
      const outputPromise = cache.get(target.cacheKey) ?? target.load();
      cache.set(target.cacheKey, outputPromise);

      const output = await outputPromise;
      const contentLength = getToolContentLength(output);
      if (returnedContentLength + contentLength > MAX_TOTAL_TOOL_CONTENT_LENGTH) {
        throw new Error(i18n._({ id: "errors.totalImageSize", message: "The total image and SVG size allowed for this question has been exceeded." }));
      }
      returnedContentLength += contentLength;
      return output;
    } catch (error) {
      return { type: "error", error: getErrorMessage(error) };
    }
  };
}

function parseReadImageArgs(argumentsJson: string): string {
  const value: unknown = JSON.parse(argumentsJson);
  if (!value || typeof value !== "object") throw new Error(i18n._({ id: "errors.invalidArguments", message: "Invalid arguments." }));

  const { ref } = value as Record<string, unknown>;
  if (typeof ref !== "string" || !ref.trim()) {
    throw new Error(i18n._({ id: "errors.refRequired", message: "ref must be a non-empty string." }));
  }
  return ref;
}

function getToolContentLength(output: ToolSuccessOutput): number {
  return output.type === "image"
    ? output.dataUrl.length
    : new TextEncoder().encode(output.content).byteLength;
}

function resolveReadTarget(
  ref: string,
  baseUrl: string,
  resources: ReadonlyMap<string, PageResourceEntry>
): ReadTarget {
  const entry = resources.get(ref);
  if (entry) return targetFromEntry(ref, entry);

  const source = resolveImageSource(ref, baseUrl);
  return { cacheKey: `source:${source}`, load: () => loadSource(source) };
}

function targetFromEntry(ref: string, entry: PageResourceEntry): ReadTarget {
  if (entry.type === "inline-text") {
    throw new Error(i18n._({ id: "errors.textRefAsImage", message: "This ref identifies a script or style. Use read or grep." }));
  }
  if (entry.type === "source") {
    return { cacheKey: `source:${entry.source}`, load: () => loadSource(entry.source) };
  }
  if (entry.type === "svg") {
    return {
      cacheKey: `ref:${ref}`,
      load: async () => ({ type: "text", content: entry.content })
    };
  }
  if (entry.type === "canvas") {
    return { cacheKey: `ref:${ref}`, load: () => captureCanvas(entry.element) };
  }
  return { cacheKey: `ref:${ref}`, load: () => captureVideoFrame(entry.element) };
}

function resolveImageSource(ref: string, baseUrl: string): string {
  return resolveResourceUrl(ref, baseUrl, IMAGE_RESOURCE_SCHEMES, i18n._({ id: "resources.image", message: "image" }));
}

async function loadSource(source: string): Promise<ToolSuccessOutput> {
  const { buffer } = await loadResource(source, {
    label: i18n._({ id: "resources.imageOrSvg", message: "image or SVG" }),
    maxBytes: MAX_IMAGE_BYTES
  });

  const bytes = new Uint8Array(buffer);
  const mimeType = detectImageMimeType(bytes);
  if (mimeType) return imageOutputFromBuffer(buffer, mimeType);

  const svg = parseSvgText(buffer);
  if (svg !== null) return { type: "text", content: svg };
  throw new Error(i18n._({ id: "errors.unsupportedImageFormat", message: "Only JPEG, PNG, GIF, WebP, and SVG formats are supported." }));
}

async function captureCanvas(canvas: HTMLCanvasElement): Promise<ImageToolOutput> {
  if (!canvas.width || !canvas.height) throw new Error(i18n._({ id: "errors.emptyCanvas", message: "The canvas has zero size." }));
  const blob = await canvasToBlob(canvas);
  return imageOutputFromBuffer(await blob.arrayBuffer(), "image/png");
}

async function captureVideoFrame(video: HTMLVideoElement): Promise<ImageToolOutput> {
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    throw new Error(i18n._({ id: "errors.videoFrameUnavailable", message: "The current video frame is not available yet." }));
  }
  if (!video.videoWidth || !video.videoHeight) throw new Error(i18n._({ id: "errors.emptyVideo", message: "The video has zero size." }));

  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error(i18n._({ id: "errors.videoCanvasContext", message: "Could not create a drawing context for the video frame." }));

  context.drawImage(video, 0, 0);
  const blob = await canvasToBlob(canvas);
  return imageOutputFromBuffer(await blob.arrayBuffer(), "image/png");
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error(i18n._({ id: "errors.canvasToPng", message: "Could not convert the canvas to PNG." })));
      }, "image/png");
    } catch (error) {
      reject(error);
    }
  });
}

async function imageOutputFromBuffer(buffer: ArrayBuffer, mimeType: string): Promise<ImageToolOutput> {
  if (buffer.byteLength > MAX_IMAGE_BYTES) throw new Error(i18n._({ id: "errors.imageTooLarge", message: "The image exceeds 32 MiB." }));
  return {
    type: "image",
    dataUrl: await toDataUrl(buffer, mimeType),
    mimeType,
    byteLength: buffer.byteLength
  };
}

function parseSvgText(buffer: ArrayBuffer): string | null {
  const content = new TextDecoder().decode(buffer);
  const document = new DOMParser().parseFromString(content, "image/svg+xml");
  return document.documentElement.localName === "svg" ? content : null;
}

function detectImageMimeType(bytes: Uint8Array): string | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61])
    || startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])) {
    return "image/gif";
  }
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46])
    && bytes.length >= 12
    && startsWith(bytes.subarray(8), [0x57, 0x45, 0x42, 0x50])) {
    return "image/webp";
  }
  return null;
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

function toDataUrl(buffer: ArrayBuffer, mimeType: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error(i18n._({ id: "errors.imageToDataUrl", message: "Could not convert the image to a data URL." })));
    }, { once: true });
    reader.addEventListener("error", () => {
      reject(reader.error ?? new Error(i18n._({ id: "errors.imageToDataUrl", message: "Could not convert the image to a data URL." })));
    }, { once: true });
    reader.readAsDataURL(new Blob([buffer], { type: mimeType }));
  });
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : i18n._({ id: "errors.imageToolFailed", message: "Image tool execution failed." });
}
