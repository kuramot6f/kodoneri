import assert from "node:assert/strict";
import test from "node:test";
import { errorMessage } from "../src/shared/errors.ts";

test("errorMessage keeps the details of raw provider error frames", () => {
  assert.equal(errorMessage(new Error("boom")), "boom");
  assert.equal(errorMessage("overloaded"), "overloaded");
  assert.equal(
    errorMessage({ type: "response.failed", response: { error: { code: "server_error", message: "Try again" } } }),
    '{"type":"response.failed","response":{"error":{"code":"server_error","message":"Try again"}}}'
  );
  assert.equal(errorMessage(undefined), "Unknown error");
});

test("errorMessage shows the status and body of an unparsed API error", () => {
  const error = Object.assign(new Error(""), { name: "AI_APICallError", statusCode: 403, responseBody: "<html>Forbidden</html>" });
  assert.equal(errorMessage(error), "HTTP 403: <html>Forbidden</html>");
  assert.equal(errorMessage(Object.assign(new Error(""), { name: "AI_APICallError", statusCode: 401 })), "HTTP 401");
});
