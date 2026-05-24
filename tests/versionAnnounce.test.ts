/**
 * Version announce idempotency (file ledger — no Mongo required)
 * Run: npx tsx tests/versionAnnounce.test.ts
 */
import assert from 'node:assert';
import fs from 'fs-extra';
import path from 'path';

const LEDGER = path.join(process.cwd(), 'data', 'version-announcements.json');
const backup = (await fs.pathExists(LEDGER)) ? await fs.readJson(LEDGER) : null;

try {
    await fs.remove(LEDGER).catch(() => {});

    const { StateManager } = await import('../src/bot/stateManager');

    console.log('Test 1: first claim wins...');
    {
        const first = await StateManager.claimVersionAnnounce('test-9.9.9');
        const second = await StateManager.claimVersionAnnounce('test-9.9.9');
        assert.strictEqual(first, true);
        assert.strictEqual(second, false);
        console.log('  ✅ duplicate claim rejected');
    }

    console.log('Test 2: hasVersionBeenAnnounced reflects ledger...');
    {
        const announced = await StateManager.hasVersionBeenAnnounced('test-9.9.9');
        const notYet = await StateManager.hasVersionBeenAnnounced('test-9.9.8');
        assert.strictEqual(announced, true);
        assert.strictEqual(notYet, false);
        console.log('  ✅ ledger lookup correct');
    }

    console.log('Test 3: file ledger checked before claim (pre-seeded)...');
    {
        await fs.ensureDir(path.dirname(LEDGER));
        await fs.writeJson(LEDGER, ['test-preseed'], { spaces: 2 });
        const claimed = await StateManager.claimVersionAnnounce('test-preseed');
        const known = await StateManager.hasVersionBeenAnnounced('test-preseed');
        assert.strictEqual(claimed, false);
        assert.strictEqual(known, true);
        console.log('  ✅ pre-seeded file blocks re-claim');
    }

    console.log('\n✅ All version announce tests passed.\n');
} finally {
    if (backup) {
        await fs.ensureDir(path.dirname(LEDGER));
        await fs.writeJson(LEDGER, backup, { spaces: 2 });
    } else {
        await fs.remove(LEDGER).catch(() => {});
    }
}
