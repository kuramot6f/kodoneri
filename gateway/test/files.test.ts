import assert from "node:assert/strict";
import test from "node:test";
import { deleteExpiredFiles } from "../src/files.ts";

const env = { CLOUDFLARE_ACCOUNT_ID: "account", CLOUDFLARE_AI_GATEWAY_ID: "gateway", CLOUDFLARE_API_TOKEN: "token" } as unknown as Env;
const base = "https://gateway.ai.cloudflare.com/v1/account/gateway/anthropic/v1/files";

test("deletes Anthropic files older than seven hours across pages", async (t) => {
  const now = Date.parse("2026-09-24T12:00:00Z");
  const pages: Record<string, unknown> = {
    [`${base}?limit=1000`]: { data: [{ id: "new", created_at: "2026-09-24T06:00:00Z" }], has_more: true, last_id: "new" },
    [`${base}?limit=1000&after_id=new`]: { data: [{ id: "old", created_at: "2026-09-24T04:59:59Z" }], has_more: false, last_id: "old" }
  };
  const deleted: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
    if (init?.method === "DELETE") {
      deleted.push(url);
      return new Response(null, { status: 200 });
    }
    return Response.json(pages[url]);
  });

  await deleteExpiredFiles(env, now);

  assert.deepEqual(deleted, [`${base}/old`]);
});
