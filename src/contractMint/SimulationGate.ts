import type { JsonRpcProvider } from 'ethers';
import { getContractMintConfig } from './config.js';
import type { SimulationFailureCode, SimulationStatus } from './types.js';

export interface SimulationInput {
    provider: JsonRpcProvider;
    from: string;
    to: string;
    data: string;
    value: string;
}

export interface SimulationOutput {
    status: SimulationStatus;
    failure?: SimulationFailureCode;
    gasEstimate?: bigint;
    revertReason?: string;
}

function classifyRevert(msg: string): SimulationFailureCode {
    const m = msg.toLowerCase();
    if (m.includes('sold out') || m.includes('max supply')) return 'SOLD_OUT';
    if (m.includes('not active') || m.includes('sale not') || m.includes('mint not started')) return 'MINT_NOT_ACTIVE';
    if (m.includes('insufficient') && m.includes('payment')) return 'INSUFFICIENT_VALUE';
    if (m.includes('per wallet') || m.includes('wallet limit') || m.includes('max per')) return 'MAX_PER_WALLET';
    if (m.includes('allowlist') || m.includes('merkle') || m.includes('proof')) return 'ALLOWLIST_ONLY';
    if (m.includes('signature') || m.includes('invalid sig')) return 'INVALID_SIGNATURE';
    if (m.includes('already minted') || m.includes('already claimed')) return 'ALREADY_MINTED';
    if (m.includes('paused')) return 'CONTRACT_PAUSED';
    return 'UNKNOWN_REVERT';
}

export async function runSimulationGate(input: SimulationInput): Promise<SimulationOutput> {
    const cfg = getContractMintConfig();
    if (!cfg.simulationRequired && cfg.unsafeOverrideSimulation) {
        return { status: 'skipped' };
    }
    if (!cfg.simulationRequired) {
        return { status: 'skipped' };
    }

    const value = BigInt(input.value || '0');
    try {
        await input.provider.call({
            from: input.from,
            to: input.to,
            data: input.data,
            value: value > 0n ? value : 0n,
        });
    } catch (err: unknown) {
        const msg = (err as { reason?: string; message?: string }).reason ||
            (err as Error).message ||
            'revert';
        return {
            status: 'failed',
            failure: classifyRevert(msg),
            revertReason: msg.slice(0, 200),
        };
    }

    try {
        const gas = await input.provider.estimateGas({
            from: input.from,
            to: input.to,
            data: input.data,
            value: value > 0n ? value : 0n,
        });
        const maxGas = BigInt(cfg.maxGasLimit);
        if (gas > maxGas) {
            return {
                status: 'failed',
                failure: 'GAS_ESTIMATION_FAILED',
                gasEstimate: gas,
                revertReason: `Gas ${gas} exceeds MAX_GAS_LIMIT ${maxGas}`,
            };
        }
        return { status: 'passed', gasEstimate: gas };
    } catch (err: unknown) {
        const msg = (err as Error).message || 'estimateGas failed';
        return {
            status: 'failed',
            failure: classifyRevert(msg),
            revertReason: msg.slice(0, 200),
        };
    }
}
