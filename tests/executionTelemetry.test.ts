import assert from 'node:assert';
import { ExecutionReporter } from '../src/engine/ExecutionReporter';

const payload = ExecutionReporter.toTelemetryPayload(
    {
        executionId: 'execution-1',
        triggerType: 'automint',
        targetContract: '0x1111111111111111111111111111111111111111',
        walletCount: 2,
        skippedCount: 0,
        submittedCount: 2,
        confirmedCount: 0,
        revertedCount: 0,
        timeoutCount: 0,
        failedCount: 0,
        detectionLatencyMs: 4,
        classificationLatencyMs: 3,
        preflightLatencyMs: 12,
        broadcastLatencyMs: 7,
        confirmationLatencyMs: 0,
        errorsByCategory: {},
        receipts: [],
        createdAt: 1,
    } as any,
    'submitted'
);

assert.strictEqual(payload.totalToBroadcastMs, 26);
assert.strictEqual(payload.phase, 'submitted');
assert.strictEqual(payload.executionId, 'execution-1');
console.log('execution telemetry payload OK');
