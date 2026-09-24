const cases = {
  normal: { status: "ALLOW", cls: "allow", risk: "risk 08/100", message: "Known provider, normal price and budget available.", reasons: ["KNOWN_PAYEE", "WITHIN_BUDGET"] },
  vendor: { status: "REQUIRE_APPROVAL", cls: "require", risk: "risk 68/100", message: "A human owner must approve this new, high-value payee before signing.", reasons: ["NEW_PAYEE", "AMOUNT_ANOMALY", "OWNER_POLICY"] },
  attack: { status: "BLOCK", cls: "block", risk: "risk 96/100", message: "Untrusted content attempted to redirect the payment to an unapproved endpoint.", reasons: ["PROMPT_INJECTION_SIGNAL", "PAYEE_MISMATCH", "BLOCKED_ENDPOINT"] }
};

document.querySelectorAll(".scenario").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".scenario").forEach((item) => item.classList.remove("selected"));
    button.classList.add("selected");
    const item = cases[button.dataset.case];
    const status = document.querySelector("#resultStatus");
    status.className = `result-status ${item.cls}`;
    status.textContent = item.status;
    document.querySelector("#riskLabel").textContent = item.risk;
    document.querySelector("#resultMessage").textContent = item.message;
    document.querySelector("#reasonList").innerHTML = item.reasons.map((reason) => `<span>${reason}</span>`).join("");
  });
});
