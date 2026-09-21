import type { ToolOutput } from "./protocol";
import { i18n } from "./i18n.ts";

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
  throw new Error(i18n._({ id: "errors.unsupportedTool", message: "Unsupported tool: {name}", values: { name } }));
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
    return { type: "error", error: getErrorMessage(error, i18n._({ id: "errors.toolExecutionFailed", message: "Tool execution failed." })) };
  }
}

function parseGrepArgs(value: unknown): GrepArgs {
  if (!value || typeof value !== "object") throw new Error(i18n._({ id: "errors.invalidArguments", message: "Invalid arguments." }));
  const { pattern, context, offset = 0, ref, resource_type: resourceType } = value as Record<string, unknown>;
  if (typeof pattern !== "string" || !pattern || pattern.length > 200) {
    throw new Error(i18n._({ id: "errors.invalidPattern", message: "pattern must be between 1 and 200 characters." }));
  }
  if (!Number.isInteger(context) || (context as number) < 0 || (context as number) > 1000) {
    throw new Error(i18n._({ id: "errors.invalidContext", message: "context must be an integer between 0 and 1000." }));
  }
  if (!Number.isInteger(offset) || (offset as number) < 0 || (offset as number) > 1_000_000) {
    throw new Error(i18n._({ id: "errors.invalidGrepOffset", message: "offset must be an integer between 0 and 1000000." }));
  }
  const parsedRef = parseOptionalRef(ref);
  const parsedResourceType = parseOptionalResourceType(resourceType);
  if (parsedRef !== undefined && isCollectionResourceType(parsedResourceType)) {
    throw new Error(i18n._({ id: "errors.refWithCollection", message: "ref cannot be specified with resource_type={resourceType}.", values: { resourceType: parsedResourceType } }));
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
  if (!value || typeof value !== "object") throw new Error(i18n._({ id: "errors.invalidArguments", message: "Invalid arguments." }));
  const { offset, limit, ref } = value as Record<string, unknown>;
  if (!Number.isInteger(offset) || (offset as number) < 0) {
    throw new Error(i18n._({ id: "errors.invalidReadOffset", message: "offset must be a non-negative integer." }));
  }
  if (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > 10000) {
    throw new Error(i18n._({ id: "errors.invalidReadLimit", message: "limit must be an integer between 1 and 10000." }));
  }
  return { offset: offset as number, limit: limit as number, ref: parseOptionalRef(ref) };
}

function parseOptionalRef(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim() || value.length > 10000) {
    throw new Error(i18n._({ id: "errors.invalidRefLength", message: "ref must be a string between 1 and 10000 characters." }));
  }
  return value;
}

function parseOptionalResourceType(value: unknown): GrepResourceType | undefined {
  if (value === undefined) return undefined;
  if (value === "session" || value === "tab" || value === "memory"
      || value === "script" || value === "style" || value === "svg") {
    return value;
  }
  throw new Error(i18n._({ id: "errors.invalidResourceType", message: "resource_type must be one of session, tab, memory, script, style, or svg." }));
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
