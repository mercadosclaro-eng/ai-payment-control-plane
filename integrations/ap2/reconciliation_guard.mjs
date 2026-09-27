import { createHash } from 'node:crypto';

function fingerprint(operation) {
  return createHash('sha256')
    .update(JSON.stringify({
      tokenId: operation.tokenId,
      orderId: operation.orderId,
      amount: operation.amount,
      currency: operation.currency,
    }))
    .digest('hex');
}

/**
 * Minimal AP2-style settlement boundary for a no-funds demo.
 * The token is consumed only after the settlement provider confirms success.
 */
export async function completeCheckout({ tokenStore, tokenId, operation, varyntiqDecision, settle }) {
  const record = tokenStore[tokenId];
  if (!record || record.used === true) {
    return { ok: false, reason: 'token_already_used' };
  }

  const operationFingerprint = fingerprint({ ...operation, tokenId });
  if (varyntiqDecision?.decision !== 'ALLOW') {
    return {
      ok: false,
      reason: varyntiqDecision?.decision === 'REQUIRE_APPROVAL' ? 'approval_required' : 'policy_blocked',
      receipt: { decision: varyntiqDecision?.decision ?? 'BLOCK', operationFingerprint },
    };
  }

  const settlement = await settle();
  if (!settlement?.confirmed) {
    return {
      ok: false,
      reason: 'settlement_unconfirmed',
      receipt: { decision: 'ALLOW', operationFingerprint, settlementConfirmed: false },
    };
  }

  record.used = true;
  record.order_id = settlement.orderId;
  record.amount_charged = operation.amount;
  record.currency = operation.currency;
  return {
    ok: true,
    receipt: { decision: 'ALLOW', operationFingerprint, settlementConfirmed: true },
  };
}

export { fingerprint };
