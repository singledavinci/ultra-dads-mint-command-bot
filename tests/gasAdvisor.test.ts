/**
 * Gas advisor formatting
 * Run: npx tsx tests/gasAdvisor.test.ts
 */

import assert from 'node:assert';
import { formatGasAdvisorMessage, type GasAdvisorReport } from '../src/services/gasAdvisor';

const sample: GasAdvisorReport = {
    ethUsd: 2500,
    ethUsdSource: 'test',
    baseBlockMaxFeeGwei: 12.5,
    baseBlockPriorityGwei: 0.1,
    walletCount: 5,
    mintValueEth: 0,
    gasLimit: '120000',
    tiers: [
        {
            id: 'fcfs',
            label: '⚡ FCFS +3',
            hint: 'test',
            gasBribeGwei: '3',
            priorityBoostEth: 0,
            priorityBoostWei: '0',
            builderTipEth: 0,
            builderTipWei: '0',
            overdrive: false,
            maxFeeGwei: 18,
            priorityGwei: 3.5,
            maxFeePerGasWei: '18000000000',
            maxPriorityFeePerGasWei: '3500000000',
            gasLimit: '120000',
            costEthPerWallet: 0.002,
            costUsdPerWallet: 5,
            totalEth: 0.01,
            totalUsd: 25,
            suggestedInclusionMode: 'public',
        },
    ],
    warnings: [],
};

const msg = formatGasAdvisorMessage(sample, 'Contract <code>0xabc</code>');
assert(msg.includes('gwei'), 'shows gwei');
assert(msg.includes('$25.00') || msg.includes('$25'), 'shows USD total');
assert(msg.includes('FCFS'), 'shows tier label');
JSON.stringify(sample);
console.log('✅ gasAdvisor tests passed\n');
