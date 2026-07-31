/**
 * Live network gas tier math (MintDash-aligned)
 * Run: npx tsx tests/networkGas.test.ts
 */
import assert from 'node:assert/strict';
import { parseUnits } from 'ethers';
import { computeGasFeesForTier } from '../src/services/networkGas';
import { applyInclusionGasAdjustments, paddedGasLimit } from '../src/services/executionGas';

const live = {
    baseMaxFee: parseUnits('12', 'gwei'),
    basePriorityFee: parseUnits('0.5', 'gwei'),
};

const normal = computeGasFeesForTier(live, 'normal')!;
const fcfs = computeGasFeesForTier(live, 'fcfs')!;

// Network: maxFee = base + tip (no ×1.15)
assert.ok(Math.abs(normal.maxFeeGwei - 12.5) < 0.01, `normal maxFee should be base+tip, got ${normal.maxFeeGwei}`);
assert.ok(normal.isNetworkTier, 'normal is network tier');
assert.ok(!fcfs.isNetworkTier, 'fcfs is competitive');
assert.ok(fcfs.priorityGwei >= 3, 'fcfs tip floor ≥ 3 gwei');
assert.ok(fcfs.maxFeeGwei > normal.maxFeeGwei, 'fcfs maxFee above network');

// Pads
const netPad = paddedGasLimit(100_000n, 'normal');
const compPad = paddedGasLimit(100_000n, 'fcfs_plus');
assert.equal(netPad, 103_000n, 'network pad 3%');
assert.equal(compPad, 110_000n, 'competitive pad 10%');

// Inclusion floors leave network alone
const netAdj = applyInclusionGasAdjustments({
    maxFeePerGas: normal.maxFeePerGas,
    maxPriorityFeePerGas: normal.maxPriorityFeePerGas,
    baseFeeWei: live.baseMaxFee,
    gasTierId: 'normal',
    inclusionMode: 'private_rpc_direct',
});
assert.equal(netAdj.maxFeePerGas, normal.maxFeePerGas);

const fcfsAdj = applyInclusionGasAdjustments({
    maxFeePerGas: fcfs.maxFeePerGas,
    maxPriorityFeePerGas: fcfs.maxPriorityFeePerGas,
    baseFeeWei: live.baseMaxFee,
    gasTierId: 'fcfs_plus',
    inclusionMode: 'private_rpc_direct',
});
assert.ok(fcfsAdj.maxPriorityFeePerGas >= parseUnits('5', 'gwei'), 'competitive Direct tip floor');
assert.ok(
    fcfsAdj.maxFeePerGas >= live.baseMaxFee * 4n + fcfsAdj.maxPriorityFeePerGas,
    'competitive Direct 4× base headroom'
);

console.log('networkGas.test.ts: ok');
