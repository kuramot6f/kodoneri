import assert from "node:assert/strict";
import test from "node:test";
import { deleteExpiredFiles } from "../src/files.ts";

const env = { ANTHROPIC_API_KEY: "key" } as Env;
const base = "https://api.anthropic.com/v1/files";

test("deletes Anthropic files older than seven hours across pages", async (t) => {
  const now = Date.parse("2026-09-24T12:00:00Z");
  const pages: Record<string, unknown> = {
    [`${base}?limit=1000`]: { data: [{ id: "new", created_at: "2026-09-24T06:00:00Z" }], has_more: true, last_id: "new" },
    [`${base}?limit=1000&after_id=new`]: { data: [{ id: "old", created_at: "2026-09-24T04:59:59Z" }], has_more: false, last_id: "old" }
  };
  const deleted: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
    assert.equal(new Headers(init?.headers).get("x-api-key"), "key");
    if (init?.method === "DELETE") {
      deleted.push(url);
      return new Response(null, { status: 200 });
    }
    return Response.json(pages[url]);
  });

  await deleteExpiredFiles(env, now);

  assert.deepEqual(deleted, [`${base}/old`]);
});
