import type { BotState } from '../src/bot/stateManager.js';
import {
    accessCodesMatch,
    grantUserUnlock,
    invalidateAllUnlocks,
    revokeUserAccess,
    userCanUseBot,
} from '../src/bot/accessGate.js';

function assert(cond: boolean, msg: string) {
    if (!cond) throw new Error(msg);
}

const admin = '111';

const base: BotState = {
    trackedAddresses: [],
    autoMint: false,
    skipSimulation: false,
    providerUrl: '',
    mintAddress: '',
    mintAmount: '0',
    mnemonic: 'test test test test test test test test test test test junk',
    userWallets: {},
    userHdWalletExcluded: {},
    userWalletLabels: {},
    importedWallets: {},
};

assert(userCanUseBot(base, '222', admin), 'open bot');
assert(accessCodesMatch('  abc  ', 'abc'), 'trim match');

const locked: BotState = {
    ...base,
    accessCode: 'secret',
    unlockedUsers: [],
    userWallets: { '333': 2 },
};
assert(!userCanUseBot(locked, '333', admin), 'wallet alone does not grant access');
assert(!userCanUseBot(locked, '444', admin), 'new user blocked');

grantUserUnlock(locked, '444');
assert(userCanUseBot(locked, '444', admin), 'after unlock');

const { clearedUnlocks } = invalidateAllUnlocks(locked, admin);
assert(clearedUnlocks === 1, 'rotation clears unlocks');
assert(!userCanUseBot(locked, '444', admin), 'must unlock again after code change');
assert(userCanUseBot(locked, admin, admin), 'admin always ok');

revokeUserAccess(locked, '444');
assert(!userCanUseBot(locked, '444', admin), 'revoked until unlock');

console.log('accessGate.test.ts: ok');
