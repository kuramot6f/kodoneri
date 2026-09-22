const MAX_MATCHES = 20;
const MAX_MATCH_LENGTH = 1000;

type GrepResourceType = "session" | "tab" | "memory" | "script" | "style" | "svg";

export interface GrepArgs {
  pattern: string;
  context: number;
  offset?: number;
  ref?: string;
  resource_type?: GrepResourceType;
}

export interface ReadArgs {
  offset: number;
  limit: number;
  ref?: string;
}

interface GrepMatch {
  matchOffset: number;
  matchEnd: number;
  before: string;
  match: string;
  matchTruncated: boolean;
  after: string;
}

export interface GrepResult {
  totalCharacters: number;
  scannedMatches: number;
  /** Known only when the text was scanned to its end. */
  totalMatches?: number;
  offset: number;
  returnedMatches: number;
  hasMore: boolean;
  nextOffset?: number;
  matches: GrepMatch[];
}

export function grepText(text: string, { pattern, context, offset = 0 }: GrepArgs): GrepResult {
  const regex = new RegExp(pattern, "g");
  const matches: GrepMatch[] = [];
  let scannedMatches = 0;
  let hasMore = false;

  for (let match = regex.exec(text); match; match = regex.exec(text)) {
    if (match[0].length === 0) regex.lastIndex += 1;
    scannedMatches += 1;
    if (scannedMatches <= offset) continue;
    if (matches.length === MAX_MATCHES) {
      hasMore = true;
      break;
    }
    const matchOffset = match.index;
    const matchEnd = matchOffset + match[0].length;
    matches.push({
      matchOffset,
      matchEnd,
      before: text.slice(Math.max(0, matchOffset - context), matchOffset),
      match: match[0].slice(0, MAX_MATCH_LENGTH),
      matchTruncated: match[0].length > MAX_MATCH_LENGTH,
      after: text.slice(matchEnd, matchEnd + context)
    });
  }

  return {
    totalCharacters: text.length,
    scannedMatches,
    ...(hasMore ? {} : { totalMatches: scannedMatches }),
    offset,
    returnedMatches: matches.length,
    hasMore,
    ...(hasMore ? { nextOffset: offset + matches.length } : {}),
    matches
  };
}

export function readText(text: string, { offset, limit }: ReadArgs) {
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

/**
 * Greps several resources as one result list: offset skips matches across all of them and at most
 * 20 matches are returned in total. A resource whose grep throws is reported under errors.
 */
export async function aggregateGrep<T extends { ref: string }>(
  resources: T[],
  offset: number,
  grep: (resource: T, offset: number) => Promise<GrepResult>,
  metadata: (resource: T) => Record<string, unknown> = ({ ref }) => ({ ref })
) {
  const results: Record<string, unknown>[] = [];
  const errors: { ref: string; error: string }[] = [];
  let skip = offset;
  let remaining = MAX_MATCHES;
  let hasMore = false;

  for (const resource of resources) {
    let result: GrepResult;
    try {
      result = await grep(resource, remaining > 0 ? skip : 0);
    } catch (error) {
      errors.push({ ref: resource.ref, error: error instanceof Error ? error.message : String(error) });
      continue;
    }
    if (remaining === 0) {
      if (result.matches.length > 0 || result.hasMore) {
        hasMore = true;
        break;
      }
      continue;
    }
    if (!result.hasMore && skip >= (result.totalMatches ?? result.scannedMatches)) {
      skip -= result.totalMatches ?? result.scannedMatches;
      continue;
    }
    skip = 0;

    const matches = result.matches.slice(0, remaining);
    if (matches.length > 0) {
      const { totalCharacters, scannedMatches, totalMatches } = result;
      results.push({ ...metadata(resource), totalCharacters, scannedMatches, ...(totalMatches === undefined ? {} : { totalMatches }), matches });
      remaining -= matches.length;
    }
    if (remaining === 0 && result.hasMore) {
      hasMore = true;
      break;
    }
  }

  const returnedMatches = MAX_MATCHES - remaining;
  return {
    offset,
    returnedMatches,
    hasMore,
    ...(hasMore ? { nextOffset: offset + returnedMatches } : {}),
    results,
    ...(errors.length > 0 ? { errors } : {})
  };
}
