import type { JsonRpcProvider } from 'ethers';
import type { ContractMintPlan, DetectedContractMint } from '../types.js';
import { getContractMintConfig } from '../config.js';
import { runSimulationGate } from '../SimulationGate.js';
import { externalApiStrategy } from './externalApiStrategy.js';
import { genericEip712Strategy } from './genericEip712Strategy.js';
import { openseaDropStrategy } from './openseaDropStrategy.js';
import { scatterApiStrategy } from './scatterApiStrategy.js';
import { seaDropSignedStrategy } from './seaDropSignedStrategy.js';
import type { SignatureMintAttempt, SignatureMintContext } from './types.js';

const STRATEGIES = [
    openseaDropStrategy,
    scatterApiStrategy,
    externalApiStrategy,
    seaDropSignedStrategy,
    genericEip712Strategy,
];

export interface SignatureMintRouterResult {
    plan: ContractMintPlan | null;
    attempts: SignatureMintAttempt[];
    winningMethod?: string;
}

export async function trySignatureMintRoutes(params: {
    detected: DetectedContractMint;
    signerAddress: string;
    quantity: number;
    provider: JsonRpcProvider;
    privateKeyForSign?: string;
}): Promise<SignatureMintRouterResult> {
    const cfg = getContractMintConfig();
    if (!cfg.signatureMintEnabled) {
        return { plan: null, attempts: [] };
    }

    const ctx: SignatureMintContext = {
        detected: params.detected,
        signerAddress: params.signerAddress,
        quantity: params.quantity,
        chainId: params.detected.chainId,
        whaleTxData: params.detected.calldata,
        whaleTxValue: params.detected.valueWei,
    };

    (globalThis as { __sigMintProvider?: JsonRpcProvider }).__sigMintProvider = params.provider;
    (globalThis as { __sigMintPk?: string }).__sigMintPk = params.privateKeyForSign;

    const attempts: SignatureMintAttempt[] = [];

    for (const strategy of STRATEGIES) {
        const attempt = await strategy.tryBuild(ctx);
        attempts.push(attempt);
        if (!attempt.ok || !attempt.plan) continue;

        const p = attempt.plan;
        const sim = await runSimulationGate({
            provider: params.provider,
            from: params.signerAddress,
            to: p.executionTarget!,
            data: p.calldata!,
            value: p.value || '0x0',
        });

        if (sim.status !== 'passed' && cfg.simulationRequired && !cfg.unsafeOverrideSimulation) {
            attempt.ok = false;
            attempt.reason = `Simulation failed (${attempt.method}): ${sim.revertReason || sim.failure}`;
            continue;
        }

        const fullPlan: ContractMintPlan = {
            chainId: params.detected.chainId,
            tokenContract: p.tokenContract || params.detected.tokenContract,
            executionTarget: p.executionTarget!,
            mintType: p.mintType || 'unknown',
            tokenStandard: params.detected.tokenStandard,
            functionName: p.functionName || attempt.method,
            selector: p.selector || p.calldata!.slice(0, 10),
            quantity: params.quantity,
            value: p.value || '0x0',
            calldata: p.calldata!,
            confidence: (p.confidence as ContractMintPlan['confidence']) || 'medium',
            reason: attempt.reason,
            simulationStatus: sim.status === 'passed' ? 'passed' : sim.status,
            simulationFailure: sim.failure,
            estimatedGas: sim.gasEstimate,
            executable: true,
            category: p.category || 'CONDITIONAL',
            sourceTxHash: params.detected.txHash,
            whaleAddress: params.detected.whaleAddress,
            actionTaken: `signature_mint:${attempt.method}`,
        };

        return { plan: fullPlan, attempts, winningMethod: attempt.method };
    }

    return { plan: null, attempts };
}