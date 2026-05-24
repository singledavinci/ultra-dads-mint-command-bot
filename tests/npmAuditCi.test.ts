/**
 * CI audit script smoke
 * Run: npx tsx tests/npmAuditCi.test.ts
 */

import { execSync } from 'node:child_process';
import assert from 'node:assert';

console.log('Test: npm run audit:ci exits 0...');
execSync('npm run audit:ci', { stdio: 'pipe', cwd: process.cwd() });
console.log('  ✅ audit:ci passed');

console.log('\n✅ npm audit CI test passed.\n');
