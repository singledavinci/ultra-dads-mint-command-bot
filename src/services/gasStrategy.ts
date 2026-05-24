/**
 * Gas Strategy Service — intelligent gas pricing for mainnet survival.
 *
 * Modes:
 *   normal   — current network fees + small buffer (default)
 *   mirror   — copy source tx gas only if significantly higher than network
 *   overdrive — 4x gas for competitive mints (admin-only)
 *   fixed    — admin-configured static values
 *
 * Key behaviors:
 *   - Normal gas by default (no 4x multiplier)
 *   - Overdrive only when explicitly enabled
 *   - Source tx gas mirrored only when meaningfully higher
 *   - Unfunded wallets skipped before broadcast
 *   - Per-wallet gas estimation when possible
 *   - All values capped to prevent absurd fees
 */

import { JsonRpcProvider, Wallet, formatEther, parseUnits } from 'ethers';
import type { FeeData, TransactionRequest } from 'ethers';
import { computePreflightGasCost, totalRequiredWei } from '../engine/gasCost';

export type GasMode = 'normal' | 'mirror' | 'overdrive' | 'fixed';

export interface GasConfig {
    mode: GasMode;
    normalMultiplier: number;       // 1.15 default
    mirrorThreshold: number;        // 1.5 — only mirror if source > network * this
    maxFeeGwei: number;             // 80 gwei cap
    maxPriorityFeeGwei: number;     // 5 gwei cap
    overdriveMaxFeeGwei: number;    // 150 gwei cap
    overdrivePriorityFeeGwei: number; // 15 gwei
    gasLimitMultiplier: number;     // 1.15
    fallbackGasLimit: number;       // 300000
    strictBalanceCheck: boolean;    // true
    skipUnfundedWallets: boolean;   // true
    minWalletBufferEth: number;     // 0.003
}

export interface GasPlan {
    mode: GasMode;
    gasLimit: bigint;
    estimatedGas: bigint;
    gasLimitMultiplier: number;
    maxFeePerGas: bigint;
    maxPriorityFeePerGas: bigint;
    estimatedGasCostEth: string;
    requiredBalanceEth: string;
    requiredBalanceWei: bigint;
    sourceTxGasWasMirrored: boolean;
    warnings: string[];
}

export interface WalletFundingCheck {
    address: string;
    balance: bigint;
    required: bigint;
    shortage: bigint;
    funded: boolean;
    balanceEth: string;
    requiredEth: string;
    shortageEth: string;
}

/** Load gas config from environment */
export function loadGasConfig(): GasConfig {
    return {
        mode: (process.env.GAS_MODE as GasMode) || 'normal',
        normalMultiplier: parseFloat(process.env.NORMAL_GAS_MULTIPLIER || '1.15'),
        mirrorThreshold: parseFloat(process.env.MIRROR_SOURCE_GAS_THRESHOLD || '1.5'),
        maxFeeGwei: parseFloat(process.env.MAX_FEE_GWEI || '80'),
        maxPriorityFeeGwei: parseFloat(process.env.MAX_PRIORITY_FEE_GWEI || '5'),
        overdriveMaxFeeGwei: parseFloat(process.env.OVERDRIVE_MAX_FEE_GWEI || '150'),
        overdrivePriorityFeeGwei: parseFloat(process.env.OVERDRIVE_PRIORITY_FEE_GWEI || '15'),
        gasLimitMultiplier: parseFloat(process.env.GAS_LIMIT_MULTIPLIER || '1.15'),
        fallbackGasLimit: parseInt(process.env.FALLBACK_GAS_LIMIT || '120000', 10),
        strictBalanceCheck: process.env.STRICT_BALANCE_CHECK !== 'false',
        skipUnfundedWallets: process.env.SKIP_UNFUNDED_WALLETS !== 'false',
        minWalletBufferEth: parseFloat(process.env.MIN_WALLET_BUFFER_ETH || '0.0001'),
    };
}

/**
 * Build a gas plan for a transaction.
 */
export async function buildGasStrategy(params: {
    provider: JsonRpcProvider;
    to: string;
    data: string;
    value: string;
    from: string;
    overdriveEnabled?: boolean;
    sourceTxMaxFee?: bigint;
    sourceTxPriorityFee?: bigint;
    config?: GasConfig;
}): Promise<GasPlan> {
    const config = params.config || loadGasConfig();
    const warnings: string[] = [];
    let mode = config.mode;

    // Override mode if overdrive is explicitly enabled
    if (params.overdriveEnabled && mode !== 'fixed') {
        mode = 'overdrive';
    }

    // 1. Get current network fees
    let feeData: FeeData;
    try {
        feeData = await params.provider.getFeeData();
    } catch {
        warnings.push('Could not fetch fee data — using safe defaults');
        feeData = { maxFeePerGas: parseUnits('30', 'gwei'), maxPriorityFeePerGas: parseUnits('1.5', 'gwei') } as any;
    }

    const networkMaxFee = feeData.maxFeePerGas || parseUnits('30', 'gwei');
    const networkPriority = feeData.maxPriorityFeePerGas || parseUnits('1.5', 'gwei');

    // 2. Calculate gas prices based on mode
    let maxFeePerGas: bigint;
    let maxPriorityFeePerGas: bigint;
    let sourceMirrored = false;

    switch (mode) {
        case 'normal': {
            const multiplier = BigInt(Math.round(config.normalMultiplier * 100));
            maxFeePerGas = (networkMaxFee * multiplier) / 100n;
            maxPriorityFeePerGas = (networkPriority * multiplier) / 100n;
            break;
        }
        case 'mirror': {
            if (params.sourceTxMaxFee && params.sourceTxPriorityFee) {
                const threshold = BigInt(Math.round(config.mirrorThreshold * 100));
                const networkThreshold = (networkMaxFee * threshold) / 100n;

                if (params.sourceTxMaxFee > networkThreshold) {
                    // Source tx gas is significantly higher — mirror it
                    maxFeePerGas = params.sourceTxMaxFee;
                    maxPriorityFeePerGas = params.sourceTxPriorityFee;
                    sourceMirrored = true;
                } else {
                    // Source tx gas is normal — use normal mode
                    const multiplier = BigInt(Math.round(config.normalMultiplier * 100));
                    maxFeePerGas = (networkMaxFee * multiplier) / 100n;
                    maxPriorityFeePerGas = (networkPriority * multiplier) / 100n;
                    warnings.push('Source tx gas was not significantly higher — using normal gas');
                }
            } else {
                // No source tx data — fall back to normal
                const multiplier = BigInt(Math.round(config.normalMultiplier * 100));
                maxFeePerGas = (networkMaxFee * multiplier) / 100n;
                maxPriorityFeePerGas = (networkPriority * multiplier) / 100n;
                warnings.push('No source tx gas data — using normal gas');
            }
            break;
        }
        case 'overdrive': {
            maxFeePerGas = parseUnits(config.overdriveMaxFeeGwei.toString(), 'gwei');
            maxPriorityFeePerGas = parseUnits(config.overdrivePriorityFeeGwei.toString(), 'gwei');
            warnings.push('⚠️ OVERDRIVE GAS ACTIVE — high fees');
            break;
        }
        case 'fixed': {
            maxFeePerGas = parseUnits(config.maxFeeGwei.toString(), 'gwei');
            maxPriorityFeePerGas = parseUnits(config.maxPriorityFeeGwei.toString(), 'gwei');
            break;
        }
        default: {
            const multiplier = BigInt(Math.round(config.normalMultiplier * 100));
            maxFeePerGas = (networkMaxFee * multiplier) / 100n;
            maxPriorityFeePerGas = (networkPriority * multiplier) / 100n;
        }
    }

    // 3. Apply caps
    const maxFeeCap = parseUnits(
        (mode === 'overdrive' ? config.overdriveMaxFeeGwei : config.maxFeeGwei).toString(),
        'gwei'
    );
    const maxPriorityCap = parseUnits(
        (mode === 'overdrive' ? config.overdrivePriorityFeeGwei : config.maxPriorityFeeGwei).toString(),
        'gwei'
    );

    if (maxFeePerGas > maxFeeCap) {
        maxFeePerGas = maxFeeCap;
        warnings.push(`maxFeePerGas capped at ${mode === 'overdrive' ? config.overdriveMaxFeeGwei : config.maxFeeGwei} gwei`);
    }
    if (maxPriorityFeePerGas > maxPriorityCap) {
        maxPriorityFeePerGas = maxPriorityCap;
    }

    // Ensure priority <= maxFee
    if (maxPriorityFeePerGas > maxFeePerGas) {
        maxPriorityFeePerGas = maxFeePerGas;
    }

    // 4. Gas limit — skip estimateGas when SKIP_RPC_PREFLIGHT (saves RPC on multi-wallet runs)
    let estimatedGas: bigint;
    let gasLimit: bigint;
    const skipRpcPreflight = process.env.SKIP_RPC_PREFLIGHT !== 'false';
    const baseGasOnly = process.env.BASE_GAS_ONLY !== 'false';

    if (skipRpcPreflight) {
        if (baseGasOnly) {
            const gasPrice = feeData.gasPrice ?? feeData.maxFeePerGas ?? networkMaxFee;
            maxFeePerGas = gasPrice;
            if (maxPriorityFeePerGas > maxFeePerGas) maxPriorityFeePerGas = maxFeePerGas;
        }
        const fastLimit = parseInt(process.env.FAST_GAS_LIMIT || '150000', 10);
        estimatedGas = BigInt(fastLimit);
        gasLimit = estimatedGas;
        warnings.push('Fast path: base gas + fixed limit (no estimateGas RPC)');
    } else {
        try {
            estimatedGas = await params.provider.estimateGas({
                to: params.to,
                data: params.data,
                value: params.value,
                from: params.from,
            });
            gasLimit = (estimatedGas * BigInt(Math.round(config.gasLimitMultiplier * 100))) / 100n;
        } catch {
            if (config.strictBalanceCheck) {
                warnings.push('Gas estimation failed — using fallback limit (strict mode)');
            } else {
                warnings.push('Gas estimation failed — using fallback limit');
            }
            estimatedGas = BigInt(config.fallbackGasLimit);
            gasLimit = BigInt(config.fallbackGasLimit);
        }
    }

    // 5. Calculate costs (realistic preflight — not maxFee × gasLimit)
    const valueWei = BigInt(params.value);
    const preflight = computePreflightGasCost({
        feeData,
        gasLimit,
        estimatedGas,
        maxFeePerGas,
        maxPriorityFeePerGas,
        bufferEth: config.minWalletBufferEth,
    });
    const requiredWei = totalRequiredWei(valueWei, preflight);

    return {
        mode,
        gasLimit,
        estimatedGas,
        gasLimitMultiplier: config.gasLimitMultiplier,
        maxFeePerGas,
        maxPriorityFeePerGas,
        estimatedGasCostEth: preflight.gasReserveEth,
        requiredBalanceEth: formatEther(requiredWei),
        requiredBalanceWei: requiredWei,
        sourceTxGasWasMirrored: sourceMirrored,
        warnings,
    };
}

/**
 * Check if a wallet has enough funds for a transaction.
 */
export async function checkWalletFunding(
    provider: JsonRpcProvider,
    address: string,
    requiredWei: bigint
): Promise<WalletFundingCheck> {
    const balance = await provider.getBalance(address);
    const shortage = requiredWei > balance ? requiredWei - balance : 0n;

    return {
        address,
        balance,
        required: requiredWei,
        shortage,
        funded: balance >= requiredWei,
        balanceEth: formatEther(balance),
        requiredEth: formatEther(requiredWei),
        shortageEth: formatEther(shortage),
    };
}

/**
 * Check funding for multiple wallets and separate funded from unfunded.
 */
export async function batchCheckFunding(
    provider: JsonRpcProvider,
    walletAddresses: string[],
    requiredPerWallet: bigint
): Promise<{ funded: WalletFundingCheck[]; unfunded: WalletFundingCheck[] }> {
    const results = await Promise.allSettled(
        walletAddresses.map(addr => checkWalletFunding(provider, addr, requiredPerWallet))
    );

    const funded: WalletFundingCheck[] = [];
    const unfunded: WalletFundingCheck[] = [];

    for (const result of results) {
        if (result.status === 'fulfilled') {
            if (result.value.funded) {
                funded.push(result.value);
            } else {
                unfunded.push(result.value);
            }
        }
    }

    return { funded, unfunded };
}

/**
 * Format a gas report for Telegram display.
 */
export function formatGasReport(plan: GasPlan, walletCount: number, fundedCount: number, skippedCount: number): string {
    const maxFeeGwei = Number(plan.maxFeePerGas / 1_000_000_000n);
    const priorityGwei = Number(plan.maxPriorityFeePerGas / 1_000_000_000n);

    let report = `<b>⛽ Gas & Funding</b>\n`;
    report += `Mode: <code>${plan.mode}</code>${plan.sourceTxGasWasMirrored ? ' (mirrored)' : ''}\n`;
    report += `Gas Limit: ${plan.gasLimit.toString()}\n`;
    report += `Max Fee: ${maxFeeGwei.toFixed(1)} gwei\n`;
    report += `Priority: ${priorityGwei.toFixed(1)} gwei\n`;
    report += `Est. Gas Cost: ${plan.estimatedGasCostEth.slice(0, 8)} ETH\n`;
    report += `Required/wallet: ${plan.requiredBalanceEth.slice(0, 8)} ETH\n`;
    report += `Wallets: ${fundedCount} funded / ${skippedCount} skipped\n`;

    if (plan.warnings.length > 0) {
        report += `\n⚠️ ${plan.warnings.join('\n⚠️ ')}`;
    }

    return report;
}
