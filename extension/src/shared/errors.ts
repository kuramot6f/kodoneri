/** Providers can put a raw error frame in the stream, so non-Error values are shown as they are instead of being dropped. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    // An API error whose body the SDK could not parse has only the status text, which HTTP/2 leaves empty.
    const { statusCode, responseBody } = error as { statusCode?: number; responseBody?: string };
    if (error.message || statusCode === undefined) return error.message || error.name;
    return [`HTTP ${statusCode}`, responseBody?.trim()].filter(Boolean).join(": ");
  }
  if (typeof error === "string" && error) return error;
  try {
    return JSON.stringify(error) ?? "Unknown error";
  } catch {
    return "Unknown error";
  }
}
