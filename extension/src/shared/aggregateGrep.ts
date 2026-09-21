import type { ToolOutput } from "./protocol";

const MAX_MATCHES = 20;

export interface AggregateGrepArgs {
  offset: number;
}

export interface ParsedGrepResult extends Record<string, unknown> {
  scannedMatches: number;
  totalMatches?: number;
  hasMore: boolean;
  matches: unknown[];
}

interface AggregateGrepOptions<T extends { ref: string }> {
  resources: T[];
  args: AggregateGrepArgs;
  run: (resource: T, offset: number) => Promise<ToolOutput>;
  metadata?: (resource: T) => Record<string, unknown>;
  nonTextError: string;
}

export async function aggregateGrep<T extends { ref: string }>({
  resources,
  args,
  run,
  metadata = ({ ref }) => ({ ref }),
  nonTextError
}: AggregateGrepOptions<T>): Promise<Record<string, unknown>> {
  const results: Array<Record<string, unknown>> = [];
  const errors: Array<{ ref: string; error: string }> = [];
  let remainingOffset = args.offset;
  let remainingLimit = MAX_MATCHES;
  let hasMore = false;

  for (const resource of resources) {
    const output = await run(resource, remainingLimit > 0 ? remainingOffset : 0);
    if (output.type !== "text") {
      errors.push({
        ref: resource.ref,
        error: output.type === "error" ? output.error : nonTextError
      });
      continue;
    }

    const result = parseGrepResult(output.content);
    if (!result) {
      errors.push({ ref: resource.ref, error: "grep結果を解析できませんでした。" });
      continue;
    }

    const knownMatches = result.totalMatches ?? result.scannedMatches;
    if (remainingLimit === 0) {
      if (result.matches.length > 0 || result.hasMore) {
        hasMore = true;
        break;
      }
      continue;
    }
    if (!result.hasMore && remainingOffset >= knownMatches) {
      remainingOffset -= knownMatches;
      continue;
    }
    remainingOffset = 0;

    const matches = result.matches.slice(0, remainingLimit);
    if (matches.length > 0) {
      const {
        matches: _matches,
        returnedMatches: _returnedMatches,
        hasMore: _hasMore,
        nextOffset: _nextOffset,
        offset: _offset,
        ...resultMetadata
      } = result;
      results.push({ ...metadata(resource), ...resultMetadata, matches });
      remainingLimit -= matches.length;
    }
    if (remainingLimit === 0 && result.hasMore) {
      hasMore = true;
      break;
    }
  }

  const returnedMatches = MAX_MATCHES - remainingLimit;
  return {
    offset: args.offset,
    returnedMatches,
    hasMore,
    ...(hasMore ? { nextOffset: args.offset + returnedMatches } : {}),
    results,
    ...(errors.length > 0 ? { errors } : {})
  };
}

export function parseGrepResult(content: string): ParsedGrepResult | null {
  try {
    const value = JSON.parse(content) as Partial<ParsedGrepResult>;
    return Number.isInteger(value.scannedMatches)
      && typeof value.hasMore === "boolean"
      && Array.isArray(value.matches)
      ? value as ParsedGrepResult
      : null;
  } catch {
    return null;
  }
}
