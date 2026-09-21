import type { ToolOutput } from "./protocol";

export interface TextToolMetadata {
  ref: string;
}

export type GrepResourceType = "session" | "tab" | "memory" | "script" | "style" | "svg";

export interface GrepArgs {
  pattern: string;
  context: number;
  offset: number;
  ref?: string;
  resourceType?: GrepResourceType;
}

interface ReadArgs {
  offset: number;
  limit: number;
  ref?: string;
}

export type ParsedTextToolCall =
  | { name: "grep"; args: GrepArgs }
  | { name: "read"; args: ReadArgs };

export function parseTextToolCall(name: string, argumentsJson: string): ParsedTextToolCall {
  const args: unknown = JSON.parse(argumentsJson);
  if (name === "grep") return { name, args: parseGrepArgs(args) };
  if (name === "read") return { name, args: parseReadArgs(args) };
  throw new Error(`未対応のツールです: ${name}`);
}

export function runTextTool(
  text: string,
  call: ParsedTextToolCall,
  metadata?: TextToolMetadata
): ToolOutput {
  try {
    const result = call.name === "grep"
      ? grepText(text, call.args)
      : readText(text, call.args);
    return {
      type: "text",
      content: JSON.stringify(metadata ? {
        ...metadata,
        ...result
      } : result)
    };
  } catch (error) {
    return { type: "error", error: getErrorMessage(error, "ツールの実行に失敗しました。") };
  }
}

function parseGrepArgs(value: unknown): GrepArgs {
  if (!value || typeof value !== "object") throw new Error("引数が不正です。");
  const { pattern, context, offset = 0, ref, resource_type: resourceType } = value as Record<string, unknown>;
  if (typeof pattern !== "string" || !pattern || pattern.length > 200) {
    throw new Error("patternは1〜200文字で指定してください。");
  }
  if (!Number.isInteger(context) || (context as number) < 0 || (context as number) > 1000) {
    throw new Error("contextは0〜1000の整数で指定してください。");
  }
  if (!Number.isInteger(offset) || (offset as number) < 0 || (offset as number) > 1_000_000) {
    throw new Error("offsetは0〜1000000の整数で指定してください。");
  }
  const parsedRef = parseOptionalRef(ref);
  const parsedResourceType = parseOptionalResourceType(resourceType);
  if (parsedRef !== undefined && isCollectionResourceType(parsedResourceType)) {
    throw new Error(`resource_type=${parsedResourceType}にはrefを指定できません。`);
  }
  return {
    pattern,
    context: context as number,
    offset: offset as number,
    ref: parsedRef,
    resourceType: parsedResourceType
  };
}

function parseReadArgs(value: unknown): ReadArgs {
  if (!value || typeof value !== "object") throw new Error("引数が不正です。");
  const { offset, limit, ref } = value as Record<string, unknown>;
  if (!Number.isInteger(offset) || (offset as number) < 0) {
    throw new Error("offsetは0以上の整数で指定してください。");
  }
  if (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > 10000) {
    throw new Error("limitは1〜10000の整数で指定してください。");
  }
  return { offset: offset as number, limit: limit as number, ref: parseOptionalRef(ref) };
}

function parseOptionalRef(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim() || value.length > 10000) {
    throw new Error("refは1〜10000文字の文字列で指定してください。");
  }
  return value;
}

function parseOptionalResourceType(value: unknown): GrepResourceType | undefined {
  if (value === undefined) return undefined;
  if (value === "session" || value === "tab" || value === "memory"
      || value === "script" || value === "style" || value === "svg") {
    return value;
  }
  throw new Error("resource_typeはsession、tab、memory、script、style、svgのいずれかを指定してください。");
}

/** session/tab/memory search every stored item of that kind and therefore take no ref. */
export function isCollectionResourceType(
  value: GrepResourceType | undefined
): value is "session" | "tab" | "memory" {
  return value === "session" || value === "tab" || value === "memory";
}

function grepText(text: string, { pattern, context, offset }: GrepArgs) {
  const regex = new RegExp(pattern, "g");
  const matches = [];
  let match: RegExpExecArray | null;
  let scannedMatches = 0;
  let hasMore = false;

  while ((match = regex.exec(text))) {
    const matchNumber = scannedMatches;
    scannedMatches += 1;
    if (matchNumber < offset) {
      if (match[0].length === 0) regex.lastIndex += 1;
      continue;
    }
    if (matches.length === 20) {
      hasMore = true;
      break;
    }
    const matchOffset = match.index;
    const matchEnd = matchOffset + match[0].length;
    matches.push({
      matchOffset,
      matchEnd,
      before: text.slice(Math.max(0, matchOffset - context), matchOffset),
      match: match[0].slice(0, 1000),
      matchTruncated: match[0].length > 1000,
      after: text.slice(matchEnd, matchEnd + context)
    });
    if (match[0].length === 0) regex.lastIndex += 1;
  }

  const nextOffset = offset + matches.length;
  return {
    totalCharacters: text.length,
    scannedMatches,
    ...(!hasMore ? { totalMatches: scannedMatches } : {}),
    offset,
    returnedMatches: matches.length,
    hasMore,
    ...(hasMore ? { nextOffset } : {}),
    matches
  };
}

function readText(text: string, { offset, limit }: ReadArgs) {
  const start = Math.min(offset, text.length);
  const end = Math.min(start + limit, text.length);
  return {
    offset: start,
    endOffset: end,
    totalCharacters: text.length,
    eof: end === text.length,
    content: text.slice(start, end)
  };
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
