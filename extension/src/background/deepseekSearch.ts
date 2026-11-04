import { tool } from "ai";
import type { ToolSet } from "ai";
import { readText } from "../shared/text.ts";
import { TOOL_DESCRIPTIONS, webFetchInput, webSearchInput } from "./toolDefinitions.ts";

const DEEPSEEK_URL = "https://api.deepseek.com";

interface SearchResult {
  title: string;
  url: string;
  summary: string;
  site_name: string | null;
  date: string | null;
}

/** DeepSeek's Search and Fetch APIs as function tools; through the gateway, `baseURL` is its DeepSeek route. */
export function deepSeekSearchTools(apiKey: string, baseURL = DEEPSEEK_URL): ToolSet {
  const call = async <T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> => {
    const response = await fetch(`${baseURL}/v1/tools/${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal
    });
    const json = await response.json().catch(() => null);
    if (!response.ok) throw new Error(json?.error?.message ?? `${path} returned HTTP ${response.status}.`);
    return json as T;
  };

  return {
    web_search: tool({
      description: TOOL_DESCRIPTIONS.web_search,
      inputSchema: webSearchInput,
      execute: async ({ query }, { abortSignal }) => {
        const { results } = await call<{ results: SearchResult[] }>("search", { query, count: 10 }, abortSignal);
        return results.map(({ title, url, summary, site_name, date }) => ({ title, url, site: site_name, date, summary }));
      }
    }),
    web_fetch: tool({
      description: TOOL_DESCRIPTIONS.web_fetch,
      inputSchema: webFetchInput,
      execute: async ({ url, offset = 0, limit = 10000 }, { abortSignal }) => {
        const { title, content } = await call<{ title: string; content: string }>("fetch", { url }, abortSignal);
        return { url, title, ...readText(content, { offset, limit }) };
      }
    })
  };
}
