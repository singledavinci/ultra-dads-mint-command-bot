/**
 * Copy-mint execution facade — production path uses CopyMintEngine.
 * Legacy implementation archived in mintCore.legacy.ts (USE_LEGACY_MINT_CORE=true).
 */

import type { JsonRpcProvider } from 'ethers';
import { CopyMintEngine } from '../engine/CopyMintEngine';
import { DetectionEngine } from '../engine/DetectionEngine';
import { getRuntimeConfig } from '../config/runtimeConfig';
import type { CopyMintEngineOptions } from '../types/copyMint';

export { waitWithTimeout, waitForTxReceipt, estimateMintRequiredWei } from './mintCore.legacy';

export type BatchCopyTradeOptions = CopyMintEngineOptions & {
    throttleSimulations?: boolean;
};

/**
 * @deprecated Use CopyMintEngine.execute — kept for Telegram bot compatibility.
 */
export const batchCopyTrade = async (
    wallets: string[],
    to: string,
    data: string,
    value: string,
    provider: JsonRpcProvider,
    options?: BatchCopyTradeOptions,
    whaleAddress?: string
) => {
    const candidate = DetectionEngine.candidateFromManual({
        to,
        data,
        value,
        sourceWallet: whaleAddress,
    });

    const result = await CopyMintEngine.execute({
        triggerType: options?.uid ? 'automint' : 'manual',
        provider,
        privateKeys: wallets,
        candidate,
        paymentPlanValue: value,
        options: {
            ...options,
            whaleAddress,
            throttleSimulations: options?.throttleSimulations,
            forceGasEstimate: options?.forceGasEstimate,
        },
    });

    return result.legacyResults;
};

export const copyTrade = async (
    walletPrivateKey: string,
    to: string,
    data: string,
    value: string,
    provider: JsonRpcProvider,
    feeData?: unknown,
    options?: BatchCopyTradeOptions
) => {
    const cfg = getRuntimeConfig();
    if (cfg.useLegacyMintCore) {
        const { copyTrade: legacy } = await import('./mintCore.legacy');
        return legacy(walletPrivateKey, to, data, value, provider, feeData as any, options as any);
    }

    const results = await batchCopyTrade([walletPrivateKey], to, data, value, provider, options);
    if (results[0]?.status === 'fulfilled') return (results[0] as any).value;
    throw (results[0] as any)?.reason || new Error('copyTrade failed');
};
