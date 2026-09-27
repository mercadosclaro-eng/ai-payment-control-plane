import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign, verify } from "node:crypto";

const BASE_INTENT = {
  agent_id: "procurement-agent",
  action: "credit-score",
  endpoint: "https://api.example/credit-score",
  recipient: "provider_treasury",
  amount: 1000000,
  currency: "USDC",
  nonce: "demo-001",
  purpose: "approved-credit-score",
};

const scenarios = [
  { name: "approved", intent: BASE_INTENT },
  { name: "recipient_changed", intent: { ...BASE_INTENT, nonce: "demo-002", recipient: "attacker_wallet" } },
  { name: "amount_changed", intent: { ...BASE_INTENT, nonce: "demo-003", amount: 5000000 } },
  { name: "replay", intent: BASE_INTENT },
  { name: "control_plane_unavailable", intent: { ...BASE_INTENT, nonce: "demo-004" }, available: false },
];

function canonical(value) {
  return JSON.stringify(value, Object.keys(value).sort());
}

function sha256(value) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

export function runConformance() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const usedNonces = new Set();
  const receipts = [];
  const results = [];

  for (const scenario of scenarios) {
    const intentHash = sha256(scenario.intent);
    let decision = "ALLOW";
    let reasons = ["KNOWN_PAYEE", "WITHIN_BUDGET", "FRESH_NONCE"];
    if (scenario.available === false) {
      decision = "BLOCK";
      reasons = ["CONTROL_PLANE_UNAVAILABLE", "NO_RECEIPT", "FAIL_CLOSED"];
    } else if (usedNonces.has(scenario.intent.nonce)) {
      decision = "BLOCK";
      reasons = ["NONCE_REPLAY", "DUPLICATE_INTENT", "FAIL_CLOSED"];
    } else if (scenario.intent.recipient !== BASE_INTENT.recipient) {
      decision = "BLOCK";
      reasons = ["PAYEE_MISMATCH", "INTENT_CHANGED", "FAIL_CLOSED"];
    } else if (scenario.intent.amount > BASE_INTENT.amount) {
      decision = "BLOCK";
      reasons = ["AMOUNT_ANOMALY", "BUDGET_EXCEEDED", "OWNER_POLICY"];
    }
    if (decision === "ALLOW") usedNonces.add(scenario.intent.nonce);

    const unsigned = { version: "conformance-v1", decision, reasons, intent_hash: intentHash, scenario: scenario.name };
    const payload = Buffer.from(JSON.stringify(unsigned));
    const signature = sign("sha256", payload, privateKey).toString("base64url");
    const receipt = { ...unsigned, signature };
    const valid = verify("sha256", payload, publicKey, Buffer.from(signature, "base64url"));
    assert.equal(valid, true, scenario.name + " receipt must verify");

    const tampered = { ...unsigned, intent_hash: "tampered" };
    const tamperedValid = verify("sha256", Buffer.from(JSON.stringify(tampered)), publicKey, Buffer.from(signature, "base64url"));
    assert.equal(tamperedValid, false, scenario.name + " tamper must fail");

    receipts.push(receipt);
    results.push({ name: scenario.name, decision, receipt_valid: valid, tamper_rejected: !tamperedValid });
  }
  assert.deepEqual(results.map((result) => result.decision), ["ALLOW", "BLOCK", "BLOCK", "BLOCK", "BLOCK"]);
  return { result: "PASS", scenarios: results, receipts: receipts.length, funds_moved: false };
}

if (process.argv[1]?.endsWith("demo-conformance.mjs")) {
  console.log(JSON.stringify(runConformance(), null, 2));
}

