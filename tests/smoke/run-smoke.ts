/**
 * Smoke test runner — offline paths only unless LIVE_BROADCAST=true.
 * Run: npm run test:smoke
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const smokeDir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'));
const root = path.resolve(smokeDir, '..', '..');
const files = fs.readdirSync(smokeDir).filter(f => f.endsWith('.smoke.ts')).sort();

console.log(`\n💨 Running ${files.length} smoke tests (LIVE_BROADCAST=${process.env.LIVE_BROADCAST || 'false'})...\n${'─'.repeat(50)}\n`);

let passed = 0;
let failed = 0;

for (const file of files) {
    if (file === 'run-smoke.ts') continue;
    const filePath = path.join(smokeDir, file);
    console.log(`▶ ${file}`);
    try {
        execSync(`npx tsx "${filePath}"`, {
            stdio: 'inherit',
            cwd: root,
            env: { ...process.env, LIVE_BROADCAST: process.env.LIVE_BROADCAST || 'false' },
        });
        passed++;
    } catch {
        failed++;
        console.error(`  ❌ FAILED: ${file}\n`);
    }
    console.log('');
}

console.log('─'.repeat(50));
console.log(`\n📊 Smoke: ${passed} passed, ${failed} failed, ${files.length} total\n`);

if (failed > 0) process.exit(1);
