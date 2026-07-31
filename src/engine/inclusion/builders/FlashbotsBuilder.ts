import { id as ethersId, Wallet } from 'ethers';
import { getRuntimeConfig } from '../../../config/runtimeConfig';
import { orderBundleTxs } from '../../../services/bundleAssembler';
import type {
    BundleSimulationResult,
    BundleSpec,
    BundleSubmitResult,
} from '../../../types/inclusion';
import type { BuilderAdapter } from './BuilderAdapter';

/**
 * Flashbots searcher relay (relay.flashbots.net).
 * v1: eth_callBundle + eth_sendBundle only. See docs/BUNDLE_MECHANICS_SPEC.md.
 */

interface JsonRpcResponse<T> {
    result?: T;
    error?: { message?: string; code?: number };
}

interface CallBundleTxResult {
    error?: string;
    gasUsed?: string;
    gasPrice?: string;
    coinbaseDiff?: string;
}

export class FlashbotsBuilder implements BuilderAdapter {
    readonly name = 'flashbots';

    private get relayUrl(): string {
        return getRuntimeConfig().flashbotsRelayUrl;
    }

    private get authKey(): string | undefined {
        return getRuntimeConfig().flashbotsAuthPrivateKey;
    }

    async simulateBundle(spec: BundleSpec): Promise<BundleSimulationResult> {
        const txs = orderBundleTxs(spec.txs);
        const blockHex = '0x' + spec.targetBlock.toString(16);

        const result = await this.rpc<{ results?: CallBundleTxResult[]; coinbaseDiff?: string }>(
            'eth_callBundle',
            [
                {
                    txs,
                    blockNumber: blockHex,
                    stateBlockNumber: blockHex,
                },
            ]
        );

        if (!result?.results?.length) {
            return { success: false, error: 'Empty simulation response' };
        }

        const errors: string[] = [];
        let totalGas = 0n;
        for (let i = 0; i < result.results.length; i++) {
            const txResult = result.results[i];
            if (txResult?.error) {
                errors.push(`tx[${i}]: ${txResult.error}`);
            }
            if (txResult?.gasUsed) {
                totalGas += BigInt(txResult.gasUsed);
            }
        }

        if (errors.length) {
            return { success: false, error: errors.join('; ') };
        }

        const coinbaseDiff = result.coinbaseDiff ? BigInt(result.coinbaseDiff) : undefined;
        return { success: true, gasUsed: totalGas, coinbaseDiff };
    }

    async sendBundle(spec: BundleSpec): Promise<BundleSubmitResult> {
        const txs = orderBundleTxs(spec.txs);
        const blockHex = '0x' + spec.targetBlock.toString(16);
        const cfg = getRuntimeConfig();

        if (cfg.builderUseMevSendBundle) {
            const body = txs.map(tx => ({ tx, canRevert: false }));
            const builders = cfg.builderMevShareBuilders?.length
                ? cfg.builderMevShareBuilders
                : undefined;
            const params: Record<string, unknown> = {
                version: 'v0.1',
                inclusion: { block: blockHex, maxBlock: blockHex },
                body,
            };
            if (builders) {
                params.privacy = { builders };
            }
            const result = await this.rpc<{ bundleHash?: string } | string>('mev_sendBundle', [
                params,
            ]);
            const bundleHash =
                typeof result === 'string'
                    ? result
                    : result && typeof result === 'object'
                      ? result.bundleHash
                      : undefined;
            if (!bundleHash) {
                throw new Error('Flashbots mev_sendBundle returned no bundleHash');
            }
            return { bundleHash, targetBlock: spec.targetBlock };
        }

        const result = await this.rpc<{ bundleHash?: string }>('eth_sendBundle', [
            {
                txs,
                blockNumber: blockHex,
            },
        ]);

        const bundleHash = result?.bundleHash;
        if (!bundleHash) {
            throw new Error('Flashbots eth_sendBundle returned no bundleHash');
        }

        return { bundleHash, targetBlock: spec.targetBlock };
    }

    async getBundleStats(bundleHash: string, targetBlock: number): Promise<{ included: boolean }> {
        try {
            const stats = await this.rpc<{
                consideredByBuildersAt?: number[];
            }>('flashbots_getBundleStats', [
                { bundleHash, blockNumber: '0x' + targetBlock.toString(16) },
            ]);
            return { included: Boolean(stats?.consideredByBuildersAt?.length) };
        } catch {
            return { included: false };
        }
    }

    private async rpc<T>(method: string, params: unknown[]): Promise<T> {
        const key = this.authKey;
        if (!key) {
            throw new Error('FLASHBOTS_AUTH_PRIVATE_KEY is required for builder bundles');
        }

        const body = JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method,
            params,
        });

        const signature = signFlashbotsBody(body, key);
        const cfg = getRuntimeConfig();
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), cfg.builderSubmitTimeoutMs);

        try {
            const res = await fetch(this.relayUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Flashbots-Signature': signature,
                },
                body,
                signal: controller.signal,
            });

            const json = (await res.json()) as JsonRpcResponse<T>;
            if (json.error?.message) {
                throw new Error(json.error.message);
            }
            if (!res.ok) {
                throw new Error(`Flashbots HTTP ${res.status}`);
            }
            return json.result as T;
        } finally {
            clearTimeout(timer);
        }
    }
}

/**
 * Flashbots relay auth: `Address:signMessage(keccak256(body))` (EIP-191).
 * Must use wallet.signMessage / signMessageSync — raw secp256k1 over the
 * keccak digest is rejected as "invalid flashbots signature".
 */
function signFlashbotsBody(body: string, privateKey: string): string {
    const pk = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
    const wallet = new Wallet(pk);
    const signature = wallet.signMessageSync(ethersId(body));
    return `${wallet.address}:${signature}`;
}
