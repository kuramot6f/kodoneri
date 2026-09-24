import type { ImageOutput } from "./protocol";

/** Longest side sent to a model; providers downscale anything larger anyway. */
const MAX_IMAGE_EDGE = 2048;
/** Below every provider's per-image limit (Anthropic's is 5 MB). */
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
/** Formats every provider reads as is; a GIF may be animated, which OpenAI rejects. */
const PORTABLE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

/** Fits an image within what every provider accepts, so a stored tool result cannot make later requests fail. */
export async function fitImage(image: ImageOutput): Promise<ImageOutput> {
  const bitmap = await createImageBitmap(new Blob([dataUrlToBytes(image.dataUrl)], { type: image.mimeType }));
  try {
    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && image.byteLength <= MAX_IMAGE_BYTES && PORTABLE_TYPES.has(image.mimeType)) return image;
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    let blob = await encode(bitmap, width, height, "image/png");
    if (blob.size > MAX_IMAGE_BYTES) blob = await encode(bitmap, width, height, "image/jpeg");
    return { type: "image", dataUrl: await toDataUrl(blob), mimeType: blob.type, byteLength: blob.size };
  } finally {
    bitmap.close();
  }
}

function encode(bitmap: ImageBitmap, width: number, height: number, type: "image/png" | "image/jpeg"): Promise<Blob> {
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not create a drawing context for the image.");
  // JPEG has no transparency; transparent pixels would turn black.
  if (type === "image/jpeg") {
    context.fillStyle = "#fff";
    context.fillRect(0, 0, width, height);
  }
  context.drawImage(bitmap, 0, 0, width, height);
  return canvas.convertToBlob({ type, quality: 0.85 });
}

export function dataUrlToBytes(dataUrl: string): Uint8Array<ArrayBuffer> {
  const separator = dataUrl.indexOf(",");
  if (!dataUrl.startsWith("data:") || !dataUrl.slice(0, separator).endsWith(";base64")) throw new Error("Invalid image data format.");
  return Uint8Array.from(atob(dataUrl.slice(separator + 1)), (character) => character.charCodeAt(0));
}

export function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Could not convert the image to a data URL."));
    }, { once: true });
    reader.addEventListener("error", () => {
      reject(reader.error ?? new Error("Could not convert the image to a data URL."));
    }, { once: true });
    reader.readAsDataURL(blob);
  });
}
