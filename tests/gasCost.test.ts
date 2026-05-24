import assert from 'node:assert/strict';
import { parseUnits } from 'ethers';
import {
    computePreflightGasCost,
    evaluateWalletFunding,
    totalRequiredWei,
} from '../src/engine/gasCost';

function testLowGasPreflight() {
    const feeData = {
        gasPrice: parseUnits('2', 'gwei'),
        maxFeePerGas: parseUnits('30', 'gwei'),
        maxPriorityFeePerGas: parseUnits('0.1', 'gwei'),
    };
    const preflight = computePreflightGasCost({
        feeData: feeData as any,
        gasLimit: 150_000n,
        estimatedGas: 100_000n,
        maxFeePerGas: parseUnits('30', 'gwei'),
        maxPriorityFeePerGas: parseUnits('0.1', 'gwei'),
        bufferEth: 0.0001,
    });
    // 100k * ~2.3 gwei ≈ 0.00023 ETH + buffer — not 150k * 30 gwei
    const total = totalRequiredWei(0n, preflight);
    assert.ok(total < parseUnits('0.001', 'ether'), `expected <0.001 ETH gas reserve, got ${total}`);
    assert.ok(preflight.gasReserveWei < 150_000n * parseUnits('30', 'gwei'));
}

function testWorstCaseHigherThanPreflight() {
    const feeData = {
        gasPrice: parseUnits('3', 'gwei'),
        maxFeePerGas: parseUnits('50', 'gwei'),
        maxPriorityFeePerGas: parseUnits('1', 'gwei'),
    };
    const preflight = computePreflightGasCost({
        feeData: feeData as any,
        gasLimit: 200_000n,
        estimatedGas: 120_000n,
        maxFeePerGas: parseUnits('50', 'gwei'),
        maxPriorityFeePerGas: parseUnits('1', 'gwei'),
        bufferEth: 0.0001,
    });
    assert.ok(preflight.worstCaseGasWei > preflight.gasReserveWei);
}

function testFundingLabels() {
    const feeData = {
        gasPrice: parseUnits('2', 'gwei'),
        maxFeePerGas: parseUnits('30', 'gwei'),
        maxPriorityFeePerGas: parseUnits('0.1', 'gwei'),
    };
    const preflight = computePreflightGasCost({
        feeData: feeData as any,
        gasLimit: 150_000n,
        estimatedGas: 80_000n,
        maxFeePerGas: parseUnits('30', 'gwei'),
        maxPriorityFeePerGas: parseUnits('0.1', 'gwei'),
        bufferEth: 0.0001,
    });
    const mint = parseUnits('0.1', 'ether');
    const gasOnly = evaluateWalletFunding(parseUnits('0.00001', 'ether'), 0n, preflight);
    assert.equal(gasOnly.ok, false);
    if (gasOnly.ok) throw new Error('expected fail');
    assert.equal(gasOnly.reason, 'insufficient_gas');

    const mintOnly = evaluateWalletFunding(parseUnits('0.05', 'ether'), mint, preflight);
    assert.equal(mintOnly.ok, false);
    if (mintOnly.ok) throw new Error('expected fail');
    assert.ok(
        mintOnly.reason === 'insufficient_mint_funds' ||
            mintOnly.reason === 'insufficient_mint_and_gas'
    );
}

testLowGasPreflight();
testWorstCaseHigherThanPreflight();
testFundingLabels();
console.log('gasCost.test.ts: ok');
