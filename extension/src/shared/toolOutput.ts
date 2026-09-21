import type { ToolOutput } from "./protocol";

export function isToolOutput(value: unknown): value is ToolOutput {
  if (!value || typeof value !== "object" || !("type" in value)) return false;
  if (value.type === "error") return "error" in value && typeof value.error === "string";
  if (value.type === "text") return "content" in value && typeof value.content === "string";
  return value.type === "image"
    && "dataUrl" in value && typeof value.dataUrl === "string"
    && "mimeType" in value && typeof value.mimeType === "string"
    && "byteLength" in value && typeof value.byteLength === "number";
}

export function stripToolImageData(output: ToolOutput): ToolOutput {
  return output.type === "image" ? { ...output, dataUrl: "" } : output;
}
