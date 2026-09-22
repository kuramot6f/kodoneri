import assert from "node:assert/strict";
import test from "node:test";
import { effectivePlan, freePeriod, FREE_ALLOWANCE_MICROUSD, type BillingRow } from "../src/billing.ts";

const row: BillingRow = {
  user_id: "user",
  app_account_token: "token",
  plan: "free",
  product_id: null,
  period_start: "2026-09-01T00:00:00.000Z",
  period_end: "2026-10-01T00:00:00.000Z",
  allowance_microusd: FREE_ALLOWANCE_MICROUSD,
  used_microusd: 0,
  input_tokens: 0,
  output_tokens: 0,
  requests: 0
};

test("free allowance is $0.50", () => {
  assert.equal(FREE_ALLOWANCE_MICROUSD, 500_000);
});

test("free period follows UTC calendar months", () => {
  assert.deepEqual(freePeriod(new Date("2026-12-31T23:59:59Z")), {
    start: "2026-12-01T00:00:00.000Z",
    end: "2027-01-01T00:00:00.000Z"
  });
});

test("expired paid plan becomes free", () => {
  assert.equal(effectivePlan({ ...row, plan: "plus", period_end: "2026-09-01T00:00:00.000Z" }, new Date("2026-09-22T00:00:00Z")), "free");
});

test("active paid plan remains paid", () => {
  assert.equal(effectivePlan({ ...row, plan: "pro", period_end: "2026-10-01T00:00:00.000Z" }, new Date("2026-09-22T00:00:00Z")), "pro");
});
