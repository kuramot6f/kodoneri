import assert from "node:assert/strict";
import test from "node:test";
import { deepSeekSearchTools } from "../src/background/deepseekSearch.ts";

const options = { toolCallId: "t", messages: [] };

test("web_search and web_fetch call DeepSeek's tool endpoints with the key", async (t) => {
  const requests: { url: string; init: RequestInit }[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    requests.push({ url, init });
    return Response.json(url.endsWith("/search")
      ? { results: [{ title: "T", url: "https://a.com", snippet: "s", summary: "sum", content: "", site_name: "A", site_icon: null, date: null, rerank_score: 2, authority: 3 }] }
      : { title: "Page", content: "abcdef" });
  });
  const tools = deepSeekSearchTools("token", "https://gateway/deepseek");

  assert.deepEqual(await tools.web_search!.execute!({ query: "q" }, options), [{ title: "T", url: "https://a.com", site: "A", date: null, summary: "sum" }]);
  assert.deepEqual(await tools.web_fetch!.execute!({ url: "https://a.com", offset: 2, limit: 3 }, options), {
    url: "https://a.com", title: "Page", offset: 2, endOffset: 5, totalCharacters: 6, eof: false, content: "cde"
  });
  assert.equal(requests[0]!.url, "https://gateway/deepseek/v1/tools/search");
  assert.deepEqual(JSON.parse(requests[0]!.init.body as string), { query: "q", count: 10 });
  assert.equal((requests[1]!.init.headers as Record<string, string>).authorization, "Bearer token");
});

test("API errors surface DeepSeek's message", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: { message: "rejected by policy" } }, { status: 403 }));
  await assert.rejects(deepSeekSearchTools("token").web_fetch!.execute!({ url: "https://a.com" }, options), /rejected by policy/);
});
