import assert from 'node:assert';
import {
    checkMintDashAccess,
    hasCachedMintDashAccess,
    linkMintDashAccount,
} from '../src/shared/app/mintDashAccess';

const previousRequired = process.env.MINTDASH_ACCESS_REQUIRED;
const previousSecret = process.env.MINTDASH_BOT_API_SECRET;
const previousUrl = process.env.MINTDASH_INTERNAL_URL;
const previousFetch = globalThis.fetch;

process.env.MINTDASH_ACCESS_REQUIRED = 'true';
process.env.MINTDASH_BOT_API_SECRET = 'test-secret';
process.env.MINTDASH_INTERNAL_URL = 'http://mintdash.test';

let responseBody: Record<string, unknown> = {
    active: true,
    linked: true,
    tier: 'PRO',
    accessExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    reason: 'active',
};

globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    assert.strictEqual(
        (init?.headers as Record<string, string>).Authorization,
        'Bearer test-secret'
    );
    return new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
}) as typeof fetch;

await checkMintDashAccess('123');
assert.strictEqual(hasCachedMintDashAccess('123'), true, 'active subscription should be cached');

responseBody = {
    active: false,
    linked: true,
    tier: 'FREE',
    accessExpiresAt: null,
    reason: 'subscription_inactive',
};
await checkMintDashAccess('123');
assert.strictEqual(hasCachedMintDashAccess('123'), false, 'inactive refresh must revoke access');

responseBody = {
    active: true,
    linked: true,
    tier: 'SCALE',
    accessExpiresAt: null,
    reason: 'active',
};
const linked = await linkMintDashAccount({ code: 'ABCD2345', telegramUserId: '456' });
assert.strictEqual(linked.tier, 'SCALE');
assert.strictEqual(hasCachedMintDashAccess('456'), true);

globalThis.fetch = previousFetch;
if (previousRequired === undefined) delete process.env.MINTDASH_ACCESS_REQUIRED;
else process.env.MINTDASH_ACCESS_REQUIRED = previousRequired;
if (previousSecret === undefined) delete process.env.MINTDASH_BOT_API_SECRET;
else process.env.MINTDASH_BOT_API_SECRET = previousSecret;
if (previousUrl === undefined) delete process.env.MINTDASH_INTERNAL_URL;
else process.env.MINTDASH_INTERNAL_URL = previousUrl;

console.log('MintDash subscription access gate OK');
