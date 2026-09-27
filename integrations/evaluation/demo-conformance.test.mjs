import assert from "node:assert/strict";
import test from "node:test";
import { runConformance } from "./demo-conformance.mjs";

test("conformance proof signs every decision and rejects tampering", () => {
  const result = runConformance();
  assert.equal(result.result, "PASS");
  assert.equal(result.receipts, 5);
  assert.equal(result.funds_moved, false);
  assert.deepEqual(result.scenarios.map((item) => item.decision), ["ALLOW", "BLOCK", "BLOCK", "BLOCK", "BLOCK"]);
  assert.equal(result.scenarios.every((item) => item.receipt_valid && item.tamper_rejected), true);
});
