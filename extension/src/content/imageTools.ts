import type { ImageOutput } from "../shared/protocol";
import { fetchBytes, resolveUrl } from "../shared/fetch";
import { toDataUrl } from "../shared/image";
import type { PageResourceEntry } from "./pageSnapshot";

const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
const MAX_TOTAL_TOOL_CONTENT_LENGTH = 44 * 1024 * 1024;
const IMAGE_SCHEMES = ["data:", "blob:", "http:", "https:"];

/** An image, or the XML text of an SVG. */
type ImageResult = ImageOutput | string;

interface ReadTarget {
  cacheKey: string;
  load: () => Promise<ImageResult>;
}

export function createImageReader(getResources: () => ReadonlyMap<string, PageResourceEntry>): (ref: string) => Promise<ImageResult> {
  const cache = new Map<string, Promise<ImageResult>>();
  let returnedLength = 0;

  return async (ref) => {
    const target = resolveReadTarget(ref, getResources());
    const pending = cache.get(target.cacheKey) ?? target.load();
    cache.set(target.cacheKey, pending);
    const output = await pending;
    const length = typeof output === "string" ? new TextEncoder().encode(output).byteLength : output.dataUrl.length;
    if (returnedLength + length > MAX_TOTAL_TOOL_CONTENT_LENGTH) {
      throw new Error("The total image and SVG size allowed for this question has been exceeded.");
    }
    returnedLength += length;
    return output;
  };
}

function resolveReadTarget(ref: string, resources: ReadonlyMap<string, PageResourceEntry>): ReadTarget {
  const entry = resources.get(ref);
  if (!entry) {
    const source = resolveUrl(ref, document.baseURI, IMAGE_SCHEMES);
    return { cacheKey: `source:${source}`, load: () => loadSource(source) };
  }
  switch (entry.type) {
    case "inline-text": throw new Error("This ref identifies a script or style. Use read or grep.");
    case "source": return { cacheKey: `source:${entry.source}`, load: () => loadSource(entry.source) };
    case "svg": return { cacheKey: `ref:${ref}`, load: async () => entry.content };
    case "canvas": return { cacheKey: `ref:${ref}`, load: () => captureCanvas(entry.element) };
    case "video": return { cacheKey: `ref:${ref}`, load: () => captureVideoFrame(entry.element) };
  }
}

async function loadSource(source: string): Promise<ImageResult> {
  const { buffer } = await fetchBytes(source, MAX_IMAGE_BYTES);
  const mimeType = detectImageMimeType(new Uint8Array(buffer));
  if (mimeType) return imageOutputFromBuffer(buffer, mimeType);
  const svg = parseSvgText(buffer);
  if (svg !== null) return svg;
  throw new Error("Only JPEG, PNG, GIF, WebP, and SVG formats are supported.");
}

async function captureCanvas(canvas: HTMLCanvasElement): Promise<ImageOutput> {
  if (!canvas.width || !canvas.height) throw new Error("The canvas has zero size.");
  const blob = await canvasToBlob(canvas);
  return imageOutputFromBuffer(await blob.arrayBuffer(), "image/png");
}

async function captureVideoFrame(video: HTMLVideoElement): Promise<ImageOutput> {
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    throw new Error("The current video frame is not available yet.");
  }
  if (!video.videoWidth || !video.videoHeight) throw new Error("The video has zero size.");

  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not create a drawing context for the video frame.");

  context.drawImage(video, 0, 0);
  const blob = await canvasToBlob(canvas);
  return imageOutputFromBuffer(await blob.arrayBuffer(), "image/png");
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Could not convert the canvas to PNG."));
      }, "image/png");
    } catch (error) {
      reject(error);
    }
  });
}

async function imageOutputFromBuffer(buffer: ArrayBuffer, mimeType: string): Promise<ImageOutput> {
  if (buffer.byteLength > MAX_IMAGE_BYTES) throw new Error("The image exceeds 32 MiB.");
  return {
    type: "image",
    dataUrl: await toDataUrl(new Blob([buffer], { type: mimeType })),
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
