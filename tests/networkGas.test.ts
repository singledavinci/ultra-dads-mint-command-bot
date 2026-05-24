/**
 * Live network gas tier math
 * Run: npx tsx tests/networkGas.test.ts
 */
import assert from 'node:assert/strict';
import { parseUnits } from 'ethers';
import { computeGasFeesForTier } from '../src/services/networkGas';

const live = {
    baseMaxFee: parseUnits('12', 'gwei'),
    basePriorityFee: parseUnits('0.5', 'gwei'),
};

const normal = computeGasFeesForTier(live, 'normal')!;
const fcfs = computeGasFeesForTier(live, 'fcfs')!;

assert.ok(normal.maxFeeGwei > 12, 'normal tier bumps live base');
assert.ok(fcfs.maxFeeGwei > normal.maxFeeGwei, 'fcfs tier adds tip on top of normal');
assert.ok(fcfs.priorityGwei > normal.priorityGwei, 'fcfs increases priority');

console.log('networkGas.test.ts: ok');
