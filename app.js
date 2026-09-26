const BASE_INTENT = {
  agent_id: "procurement-agent",
  action: "credit-score",
  endpoint: "https://api.example/credit-score",
  recipient: "provider_treasury",
  amount: 1000000,
  currency: "USDC",
  nonce: "demo-001",
  purpose: "approved-credit-score"
};

const cases = {
  allow: {
    status: "ALLOW", cls: "allow", risk: "risk 08/100",
    message: "Known recipient, exact amount and fresh nonce.",
    reasons: ["KNOWN_PAYEE", "WITHIN_BUDGET", "FRESH_NONCE"], intent: BASE_INTENT
  },
  recipient: {
    status: "BLOCK", cls: "block", risk: "risk 99/100",
    message: "The destination changed after approval. The original decision cannot be reused.",
    reasons: ["PAYEE_MISMATCH", "INTENT_CHANGED", "FAIL_CLOSED"],
    intent: { ...BASE_INTENT, recipient: "attacker_wallet" }
  },
  amount: {
    status: "BLOCK", cls: "block", risk: "risk 94/100",
    message: "The requested amount is five times the approved budget.",
    reasons: ["AMOUNT_ANOMALY", "BUDGET_EXCEEDED", "OWNER_POLICY"],
    intent: { ...BASE_INTENT, amount: 5000000 }
  },
  replay: {
    status: "BLOCK", cls: "block", risk: "risk 91/100",
    message: "This nonce has already been used. Replaying the request is refused.",
    reasons: ["NONCE_REPLAY", "DUPLICATE_INTENT", "FAIL_CLOSED"],
    intent: { ...BASE_INTENT, nonce: "demo-001-replayed" }
  },
  outage: {
    status: "BLOCK", cls: "block", risk: "risk 100/100",
    message: "No policy decision was returned. The payment fails closed before signing.",
    reasons: ["CONTROL_PLANE_UNAVAILABLE", "NO_RECEIPT", "FAIL_CLOSED"], intent: BASE_INTENT
  }
};

const byId = (id) => document.getElementById(id);
const state = { runs: 0, blocks: 0, receipt: "", keyPair: null };

function stableStringify(value) {
  return JSON.stringify(value, Object.keys(value).sort());
}

async function hashIntent(intent) {
  const payload = new TextEncoder().encode(stableStringify(intent));
  if (window.crypto?.subtle) {
    const digest = await window.crypto.subtle.digest("SHA-256", payload);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  return Array.from(payload).reduce((hash, byte) => ((hash * 31 + byte) >>> 0), 2166136261).toString(16).padStart(8, "0").repeat(8);
}

function base64Url(bytes) {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function signReceipt(receiptText) {
  if (!window.crypto?.subtle) return { signature: "unavailable", verified: false };
  try {
    if (!state.keyPair) {
      state.keyPair = await window.crypto.subtle.generateKey(
        { name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]
      );
    }
    const data = new TextEncoder().encode(receiptText);
    const signature = await window.crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" }, state.keyPair.privateKey, data
    );
    const verified = await window.crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" }, state.keyPair.publicKey, signature, data
    );
    return { signature: base64Url(new Uint8Array(signature)), verified };
  } catch {
    return { signature: "unavailable", verified: false };
  }
}

async function renderCase(caseName) {
  const item = cases[caseName];
  document.querySelectorAll(".scenario").forEach((button) => button.classList.toggle("selected", button.dataset.case === caseName));
  const hash = await hashIntent(item.intent);
  state.runs += 1;
  if (item.status === "BLOCK") state.blocks += 1;
  const receiptId = "demo_" + hash.slice(0, 10);
  const unsignedReceipt = {
    version: "demo-receipt-v1", decision: item.status, reason_codes: item.reasons,
    intent_sha256: hash, receipt_id: receiptId, policy: "varyntiq-demo-policy",
    signer_boundary: "external-signer", funds_moved: false
  };
  const signed = await signReceipt(JSON.stringify(unsignedReceipt));
  state.receipt = JSON.stringify({ ...unsignedReceipt, signature: signed.signature }, null, 2);
  const status = byId("resultStatus");
  status.className = "result-status " + item.cls;
  status.textContent = item.status;
  byId("riskLabel").textContent = item.risk;
  byId("resultMessage").textContent = item.message;
  byId("reasonList").innerHTML = item.reasons.map((reason) => "<span>" + reason + "</span>").join("");
  byId("intentHash").textContent = hash.slice(0, 18) + "…" + hash.slice(-10);
  byId("receiptId").textContent = receiptId;
  byId("signatureValue").textContent = signed.signature === "unavailable" ? "unavailable" : signed.signature.slice(0, 18) + "…";
  byId("verificationState").textContent = signed.verified ? "VALID" : "UNAVAILABLE";
  byId("runCount").textContent = state.runs;
  byId("blockCount").textContent = state.blocks;
  byId("copyReceipt").textContent = "Copy verification receipt";
}

document.querySelectorAll(".scenario").forEach((button) => button.addEventListener("click", () => renderCase(button.dataset.case)));

byId("copyReceipt")?.addEventListener("click", async (event) => {
  try {
    await navigator.clipboard.writeText(state.receipt);
    event.currentTarget.textContent = "Receipt copied";
    window.setTimeout(() => { event.currentTarget.textContent = "Copy verification receipt"; }, 1800);
  } catch {
    event.currentTarget.textContent = "Copy unavailable";
  }
});

renderCase("allow");

