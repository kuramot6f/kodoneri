/** Providers can put a raw error frame in the stream, so non-Error values are shown as they are instead of being dropped. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === "string" && error) return error;
  try {
    return JSON.stringify(error) ?? "Unknown error";
  } catch {
    return "Unknown error";
  }
}
