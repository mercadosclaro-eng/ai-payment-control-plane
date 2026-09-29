import { createArdaroPreSignGuard } from './varyntiq-ardaro.mjs';

const safePayTo = '0x1111111111111111111111111111111111111111';
const safeResource = 'https://agents.getardaro.com/mcp/utilities';
const safeNetwork = 'eip155:8453';
const usedNonces = new Set();
const counters = { policy: 0, sign: 0, payment: 0 };

const baseRequest = {
  amountMinor: '1000',
  currency: 'USDC',
  payTo: safePayTo,
  network: safeNetwork,
  asset: '0x833589fCD6eDb6E08f4C7C32D4f71b54Bda02913',
  resourceUrl: safeResource,
  limits: { max_single_spend: '1000', daily_remaining: '5000' },
};

const guard = createArdaroPreSignGuard({
  token: 'demo-token',
  agentId: 'ardaro-demo-agent',
  baseUrl: 'https://varyntiq.example',
  fetchImpl: async (_url, init) => {
    counters.policy += 1;
    const body = JSON.parse(init.body);
    const replay = usedNonces.has(body.x402.nonce);
    const unsafe = Number(body.x402.amount) > 1000 ||
      body.x402.payTo !== safePayTo ||
      body.x402.resource.url !== safeResource ||
      body.x402.network !== safeNetwork ||
      replay;
    const decision = unsafe ? 'BLOCK' : 'ALLOW';
    if (!unsafe) usedNonces.add(body.x402.nonce);
    return {
      ok: true,
      async json() {
        return {
          intent_id: body.intent_id,
          decision,
          receipt_id: 'demo-' + counters.policy,
          expires_at: new Date(Date.now() + 60000).toISOString(),
        };
      },
    };
  },
});

async function attempt(name, request) {
  try {
    await guard({
      request,
      sign: ({ intent }) => {
        counters.sign += 1;
        counters.payment += 1;
        return { signed: true, intentId: intent.intent_id };
      },
    });
    console.log(name + ': ALLOW -> mock sign/payment reached');
  } catch (error) {
    console.log(name + ': BLOCK -> sign/payment stopped (' + error.message + ')');
  }
}

await attempt('equal-limit', { ...baseRequest, nonce: 'demo-equal' });
await attempt('above-limit', { ...baseRequest, amountMinor: '1001', nonce: 'demo-above' });
await attempt('recipient-mismatch', { ...baseRequest, payTo: '0x2222222222222222222222222222222222222222', nonce: 'demo-recipient' });
await attempt('nonce-reuse-first', { ...baseRequest, nonce: 'demo-replay' });
await attempt('nonce-reuse-second', { ...baseRequest, nonce: 'demo-replay' });

console.log(JSON.stringify({ counters, fundsMoved: false }, null, 2));
