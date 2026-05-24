import { getRuntimeConfig } from '../../../config/runtimeConfig';
import type {
    BundleSimulationResult,
    BundleSpec,
    BundleSubmitResult,
} from '../../../types/inclusion';
import type { BuilderAdapter } from './BuilderAdapter';
import { FlashbotsBuilder } from './FlashbotsBuilder';

/**
 * Phase 4 — Titan relay (Flashbots-compatible JSON-RPC when URL is set).
 */
export class TitanBuilder implements BuilderAdapter {
    readonly name = 'titan';
    private readonly inner: FlashbotsBuilder;

    constructor() {
        this.inner = new FlashbotsBuilder();
    }

    private get configured(): boolean {
        return Boolean(getRuntimeConfig().titanRelayUrl?.trim());
    }

    async simulateBundle(spec: BundleSpec): Promise<BundleSimulationResult> {
        if (!this.configured) {
            return { success: false, error: 'TITAN_RELAY_URL not configured' };
        }
        return this.inner.simulateBundle(spec);
    }

    async sendBundle(spec: BundleSpec): Promise<BundleSubmitResult> {
        if (!this.configured) {
            throw new Error('TITAN_RELAY_URL not configured');
        }
        return this.inner.sendBundle(spec);
    }
}
