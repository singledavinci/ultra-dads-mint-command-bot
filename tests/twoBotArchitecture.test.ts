/**
 * Two-bot split — role resolution, command catalogs, health paths.
 */
import assert from 'node:assert/strict';
import {
    resolveBotRole,
    runsCopyMintServices,
    runsMintCommandServices,
    getServiceName,
} from '../src/shared/app/role.js';
import {
    getTelegramCommandsForRole,
    isCommandAllowedForRole,
} from '../src/shared/app/commandCatalog.js';
import { buildHealthJson, healthPathForRole } from '../src/shared/app/health.js';
import { extractCommandFromText } from '../src/shared/app/commandCatalog.js';

function withEnv(overrides: Record<string, string | undefined>, fn: () => void): void {
    const prev: Record<string, string | undefined> = {};
    for (const key of Object.keys(overrides)) {
        prev[key] = process.env[key];
        const v = overrides[key];
        if (v === undefined) delete process.env[key];
        else process.env[key] = v;
    }
    try {
        fn();
    } finally {
        for (const key of Object.keys(prev)) {
            if (prev[key] === undefined) delete process.env[key];
            else process.env[key] = prev[key];
        }
    }
}

// --- role resolution ---
withEnv(
    { BOT_ROLE: 'copy', COPY_BOT_ENABLED: 'true', MINT_BOT_ENABLED: 'false' },
    () => {
        assert.equal(resolveBotRole(), 'copy');
        assert.equal(getServiceName('copy'), 'copy-mint-bot');
        assert.equal(runsCopyMintServices('copy'), true);
        assert.equal(runsMintCommandServices('copy'), false);
    }
);

withEnv(
    { BOT_ROLE: 'mint', COPY_BOT_ENABLED: 'false', MINT_BOT_ENABLED: 'true' },
    () => {
        assert.equal(resolveBotRole(), 'mint');
        assert.equal(getServiceName('mint'), 'mint-command-bot');
        assert.equal(runsCopyMintServices('mint'), false);
        assert.equal(runsMintCommandServices('mint'), true);
    }
);

// --- command catalogs ---
const copyCommands = getTelegramCommandsForRole('copy');
const mintCommands = getTelegramCommandsForRole('mint');

assert.ok(copyCommands.some(c => c.command === 'track'));
assert.ok(copyCommands.some(c => c.command === 'automint'));
assert.ok(!copyCommands.some(c => c.command === 'blockmint'));
assert.ok(!copyCommands.some(c => c.command === 'dropmint'));

assert.ok(mintCommands.some(c => c.command === 'blockmint'));
assert.ok(mintCommands.some(c => c.command === 'mint'));
assert.ok(!mintCommands.some(c => c.command === 'track'));

assert.equal(isCommandAllowedForRole('blockmint', 'copy'), false);
assert.equal(isCommandAllowedForRole('track', 'mint'), false);
assert.equal(isCommandAllowedForRole('start', 'copy'), true);
assert.equal(isCommandAllowedForRole('start', 'mint'), true);

const copyNames = new Set(copyCommands.map(c => c.command));
const mintNames = new Set(mintCommands.map(c => c.command));
for (const name of copyNames) {
    if (mintNames.has(name)) {
        assert.ok(
            ['start', 'menu', 'unlock', 'link', 'subscription', 'help', 'guide', 'ping', 'checkdb', 'db', 'wallets', 'wallet', 'status', 'version', 'rpc', 'myrpc', 'setrpc'].includes(name),
            `unexpected shared command collision: ${name}`
        );
    }
}

// --- health JSON ---
const copyHealth = buildHealthJson({
    ok: true,
    service: 'copy-mint-bot',
    version: 'test',
    uptime: 1,
    discord: 'ready',
    walletTracker: 'running',
    rpc: 'connected',
    commands: 'loaded',
    role: 'copy',
});

assert.equal(copyHealth.service, 'copy-mint-bot');
assert.equal(copyHealth.walletTracker, 'running');
assert.equal(copyHealth.commands, undefined);

const mintHealth = buildHealthJson({
    ok: true,
    service: 'mint-command-bot',
    version: 'test',
    uptime: 1,
    discord: 'not_ready',
    walletTracker: 'stopped',
    rpc: 'connected',
    commands: 'loaded',
    role: 'mint',
});

assert.equal(mintHealth.service, 'mint-command-bot');
assert.equal(mintHealth.commands, 'loaded');
assert.equal(mintHealth.walletTracker, undefined);

assert.equal(healthPathForRole('copy'), '/health/copy-mint');
assert.equal(healthPathForRole('mint'), '/health/mint-command');
assert.equal(healthPathForRole('all'), '/health');

assert.equal(extractCommandFromText('/blockmint 123'), 'blockmint');
assert.equal(extractCommandFromText('/track@MyBot addr'), 'track');

console.log('✅ twoBotArchitecture.test.ts passed');
