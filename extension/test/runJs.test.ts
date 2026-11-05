import assert from "node:assert/strict";
import test from "node:test";
import Sval from "sval";
import { runInPage, runJs } from "../src/background/runJs.ts";
import { runJsInput } from "../src/background/toolDefinitions.ts";

(globalThis as unknown as { __chatextSval: typeof Sval }).__chatextSval = Sval;

for (const interpret of [false, true]) {
  const engine = interpret ? "interpreter" : "eval";

  test(`${engine} runs the code as an async function body with page globals`, async () => {
    (globalThis as unknown as { pageValue: number }).pageValue = 2;
    assert.deepEqual(await runInPage("const value = await Promise.resolve(pageValue); return { sum: value + 1 }; // done", interpret), { result: '{"sum":3}', truncated: false });
  });

  test(`${engine} constructs classes without an explicit constructor`, async () => {
    assert.deepEqual(await runInPage("class A { x = 1; m() { return this.x + 1 } } return new A().m();", interpret), { result: "2", truncated: false });
  });

  test(`${engine} reports thrown and syntax errors`, async () => {
    assert.deepEqual(await runInPage("throw new TypeError('nope')", interpret), { error: "TypeError: nope" });
    assert.ok("error" in await runInPage("return (", interpret));
  });

  test(`${engine} serializes nodes, missing values, and circular values`, async () => {
    assert.equal((await runInPage("return { nodeType: 1, outerHTML: '<a></a>' }", interpret) as { result: string }).result, '"<a></a>"');
    assert.equal((await runInPage("return undefined", interpret) as { result: string }).result, "null");
    assert.equal((await runInPage("const a = {}; a.a = a; return a", interpret) as { result: string }).result, "[object Object]");
  });

  test(`${engine} truncates long results`, async () => {
    const run = await runInPage("return 'x'.repeat(30000)", interpret) as { result: string; truncated: boolean };
    assert.equal(run.result.length, 20_000);
    assert.equal(run.truncated, true);
  });
}

test("a CSP rejection is reported as blocked", async () => {
  const realEval = globalThis.eval;
  globalThis.eval = () => { throw new EvalError("Refused to evaluate"); };
  try {
    assert.deepEqual(await runInPage("return 1", false), { blocked: true });
  } finally {
    globalThis.eval = realEval;
  }
});

function fakeApi(replies: unknown[]) {
  const injections: { func?: unknown; files?: string[]; args?: [string, boolean] }[] = [];
  return {
    injections,
    api: {
      scripting: {
        executeScript: async (injection: { func?: unknown; files?: string[]; args?: [string, boolean] }) => {
          injections.push(injection);
          return injection.files ? [] : replies.shift();
        }
      }
    }
  };
}

test("runJs reads both Chrome-style and direct Safari replies", async () => {
  const run = { result: "1", truncated: false };
  assert.deepEqual(await runJs(1, 0, "return 1", fakeApi([[{ frameId: 0, result: run }]]).api), { ...run, interpreted: false });
  assert.deepEqual(await runJs(1, 0, "return 1", fakeApi([[run]]).api), { ...run, interpreted: false });
  assert.deepEqual(await runJs(1, 0, "return 1", fakeApi([run]).api), { ...run, interpreted: false });
});

test("runJs retries in the interpreter only when the page blocks eval", async () => {
  const run = { result: "1", truncated: false };
  const { api, injections } = fakeApi([[{ result: { blocked: true } }], [{ result: run }]]);
  assert.deepEqual(await runJs(1, 2, "return 1", api), { ...run, interpreted: true });
  assert.deepEqual(injections.map(({ files, args }) => files?.[0] ?? args?.[1]), [false, "interpreter.js", true]);

  await assert.rejects(runJs(1, 0, "x", fakeApi([[{ result: { error: "ReferenceError: x" } }]]).api), /ReferenceError: x/);
  await assert.rejects(runJs(1, 0, "x", fakeApi([[{ result: null }]]).api), /without a result/);
});

test("run_js takes a tab or iframe ref and needs a description and code", () => {
  const description = "Returns one";
  assert.equal(runJsInput.safeParse({ description, ref: "tab_1_iframe_2", code: "return 1" }).success, true);
  assert.equal(runJsInput.safeParse({ description, ref: "tab_1_img_1", code: "return 1" }).success, false);
  assert.equal(runJsInput.safeParse({ description, ref: "tab_1" }).success, false);
  assert.equal(runJsInput.safeParse({ ref: "tab_1", code: "return 1" }).success, false);
  assert.equal(runJsInput.safeParse({ description: " ", ref: "tab_1", code: "return 1" }).success, false);
});
