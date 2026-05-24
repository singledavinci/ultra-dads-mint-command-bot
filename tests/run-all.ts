/**
 * Test runner — executes all test files sequentially.
 * Run: npx tsx tests/run-all.ts
 * Or:  npm test
 */

import { execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const testsDir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'));
const files = fs.readdirSync(testsDir)
    .filter(f => f.endsWith('.test.ts'))
    .sort();

console.log(`\n🧪 Running ${files.length} test files...\n${'─'.repeat(50)}\n`);

let passed = 0;
let failed = 0;

for (const file of files) {
    const filePath = path.join(testsDir, file);
    console.log(`▶ ${file}`);
    try {
        execSync(`npx tsx "${filePath}"`, { stdio: 'inherit', cwd: path.resolve(testsDir, '..') });
        passed++;
    } catch (e) {
        failed++;
        console.error(`  ❌ FAILED: ${file}\n`);
    }
    console.log('');
}

console.log('─'.repeat(50));
console.log(`\n📊 Results: ${passed} passed, ${failed} failed, ${files.length} total\n`);

if (failed > 0) process.exit(1);
