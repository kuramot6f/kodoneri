import type Sval from "sval";

const TIMEOUT_MS = 30_000;
const INTERPRETER_FILE = "interpreter.js";

type PageRun = { blocked: true } | { error: string } | { result: string; truncated: boolean };

interface ScriptingApi {
  scripting: {
    executeScript: (injection: {
      target: { tabId: number; frameIds: number[] };
      world: "MAIN";
      func?: typeof runInPage;
      args?: [string, boolean];
      files?: string[];
    }) => Promise<unknown>;
  };
}

/**
 * Runs in the page's own context, so it is serialized and can use nothing from outside its body.
 * Compiling comes first: a page CSP rejects it with an EvalError before any of the code has run,
 * which makes retrying in the interpreter safe.
 */
export async function runInPage(code: string, interpret: boolean): Promise<PageRun> {
  const MAX_RESULT_CHARACTERS = 20_000;
  let run: () => unknown;
  try {
    if (interpret) {
      const page = globalThis as unknown as { __chatextSval: typeof Sval };
      const interpreter = new page.__chatextSval({ ecmaVer: "latest", sandBox: false });
      run = () => {
        interpreter.run(`exports.result = (async () => {\n${code}\n})()`);
        return (interpreter.exports as { result: unknown }).result;
      };
    } else {
      run = (0, eval)(`(async () => {\n${code}\n})`);
    }
  } catch (error) {
    return error instanceof EvalError ? { blocked: true } : { error: String(error) };
  }
  try {
    const value = await run();
    let text: string;
    try {
      text = JSON.stringify(value, (_, item) => item?.nodeType ? item.outerHTML ?? item.textContent : item) ?? "null";
    } catch {
      text = String(value);
    }
    return { result: text.slice(0, MAX_RESULT_CHARACTERS), truncated: text.length > MAX_RESULT_CHARACTERS };
  } catch (error) {
    return { error: String(error) };
  }
}

export async function runJs(tabId: number, frameId: number, code: string, api: ScriptingApi = browser as unknown as ScriptingApi) {
  const target = { tabId, frameIds: [frameId] };
  const inject = (interpret: boolean) => api.scripting.executeScript({ target, world: "MAIN", func: runInPage, args: [code, interpret] }).then(pageRun);

  let run = await withTimeout(inject(false));
  const interpreted = "blocked" in run;
  if (interpreted) {
    await api.scripting.executeScript({ target, world: "MAIN", files: [INTERPRETER_FILE] });
    run = await withTimeout(inject(true));
  }
  if ("blocked" in run) throw new Error("The page blocked the script.");
  if ("error" in run) throw new Error(run.error);
  return { ...run, interpreted };
}

/** Safari may hand back the function's value itself instead of a list of injection results. */
function pageRun(reply: unknown): PageRun {
  const first = Array.isArray(reply) ? reply[0] as unknown : reply;
  const run = first && typeof first === "object" && "result" in first && !("truncated" in first) ? first.result : first;
  if (!run || typeof run !== "object") throw new Error("The script ended without a result. The page may have navigated; observe it before retrying.");
  return run as PageRun;
}

/** A script cannot be stopped from outside, so a timeout only stops waiting for it. */
async function withTimeout<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("The script did not finish within 30 seconds and may still be running. Observe the page before retrying.")), TIMEOUT_MS);
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
