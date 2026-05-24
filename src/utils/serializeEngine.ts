import type { EngineStatus, ExecutionResult } from '../types/copyMint';

function replacer(_key: string, value: unknown): unknown {
    if (typeof value === 'bigint') return value.toString();
    return value;
}

export function serializeExecutionResult(result: ExecutionResult | undefined): Record<string, unknown> | null {
    if (!result) return null;
    return JSON.parse(JSON.stringify(result, replacer));
}

export function serializeEngineStatus(status: EngineStatus): Record<string, unknown> {
    return JSON.parse(JSON.stringify(status, replacer));
}
