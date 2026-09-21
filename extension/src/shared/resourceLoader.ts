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
    throw new Error(`refを${label}URLとして解決できませんでした。`);
  }
  if (!schemes.has(url.protocol)) {
    throw new Error(`未対応のURL schemeです: ${url.protocol}`);
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
    throw new Error(`${label}を取得できませんでした。${formatCause(error)}`);
  }
  if (!response.ok) throw new Error(`${label}の取得に失敗しました（HTTP ${response.status}）。`);

  const contentLengthHeader = response.headers.get("Content-Length");
  if (contentLengthHeader !== null) {
    const contentLength = Number(contentLengthHeader);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      throw new Error(`${label}のサイズが${formatMiB(maxBytes)} MiBを超えています。`);
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
      throw new Error(`${label}のサイズが${formatMiB(maxBytes)} MiBを超えています。`);
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
      throw new Error(`${label}のサイズが${formatMiB(maxBytes)} MiBを超えています。`);
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

function formatCause(error: unknown): string {
  return error instanceof Error && error.message ? ` ${error.message}` : "";
}
