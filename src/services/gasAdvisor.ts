/**
 * FCFS gas advisor — network baseline + suggested tiers in gwei and USD.
 */

import { formatEther, JsonRpcProvider, parseUnits } from 'ethers';
import { getRuntimeConfig } from '../config/runtimeConfig';
import { intrinsicGasFloor } from '../engine/GasPlanner';
import {
    computeGasFeesForTierAsync,
    GAS_TIER_DEFS,
    resolveLiveNetworkFees,
} from './networkGas';
import { paddedGasLimit } from './executionGas';
import { priorityBoostWeiFromEth } from './builderPayment';
import { uiRow, uiScreen } from '../bot/ui/premiumMessages';
import type { InclusionMode } from '../types/inclusion';

export type { GasTierId } from './networkGas';

export interface GasTierOption {
    id: string;
    label: string;
    hint: string;
    gasBribeGwei: string;
    /** Extra EIP-1559 priority budget (ETH equiv.) — not a coinbase transfer */
    priorityBoostEth: number;
    priorityBoostWei: string;
    /** @deprecated Use priorityBoostEth */
    builderTipEth: number;
    /** @deprecated Use priorityBoostWei */
    builderTipWei: string;
    overdrive: boolean;
    maxFeeGwei: number;
    priorityGwei: number;
    maxFeePerGasWei: string;
    maxPriorityFeePerGasWei: string;
    gasLimit: string;
    costEthPerWallet: number;
    costUsdPerWallet: number;
    totalEth: number;
    totalUsd: number;
    /** Suggested inclusion mode when BUILDER_MINT_ENABLED / FCFS */
    suggestedInclusionMode: InclusionMode;
}

export interface GasAdvisorReport {
    ethUsd: number;
    ethUsdSource: string;
    baseBlockMaxFeeGwei: number;
    baseBlockPriorityGwei: number;
    walletCount: number;
    mintValueEth: number;
    gasLimit: string;
    tiers: GasTierOption[];
    warnings: string[];
}

let ethUsdCache: { price: number; at: number } | null = null;

export async function fetchEthUsd(): Promise<{ price: number; source: string }> {
    const env = parseFloat(process.env.ETH_USD_PRICE || '');
    if (env > 0) return { price: env, source: 'ETH_USD_PRICE env' };

    if (ethUsdCache && Date.now() - ethUsdCache.at < 60_000) {
        return { price: ethUsdCache.price, source: 'cache' };
    }

    try {
        const res = await fetch(
            'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd',
            { signal: AbortSignal.timeout(8000) }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { ethereum?: { usd?: number } };
        const price = json?.ethereum?.usd;
        if (price && price > 0) {
            ethUsdCache = { price, at: Date.now() };
            return { price, source: 'CoinGecko' };
        }
    } catch {
        /* fallback */
    }

    return { price: 2500, source: 'fallback estimate' };
}

function tierCostEth(gasLimit: bigint, maxFee: bigint, mintValueWei: bigint): number {
    return parseFloat(formatEther(gasLimit * maxFee + mintValueWei));
}

export async function buildGasAdvisorReport(params: {
    provider: JsonRpcProvider;
    walletCount: number;
    mintValueEth: number;
    estimateGas?: {
        to: string;
        data: string;
        value: string;
        from: string;
    };
}): Promise<GasAdvisorReport> {
    const cfg = getRuntimeConfig();
    const warnings: string[] = [];
    const mintValueWei = parseUnits(String(params.mintValueEth), 'ether');

    const calldataForFloor = params.estimateGas?.data ?? '0x';

    const estimatePromise: Promise<{ ok: boolean; gas: bigint }> = params.estimateGas
        ? params.provider
              .estimateGas({
                  to: params.estimateGas.to,
                  data: params.estimateGas.data,
                  value: params.estimateGas.value || '0',
                  from: params.estimateGas.from,
              })
              .then(gas => ({ ok: true, gas }))
              .catch(() => ({ ok: false, gas: 0n }))
        : Promise.resolve({ ok: false, gas: 0n });

    const [estimateResult, ethUsdPack, live] = await Promise.all([
        estimatePromise,
        fetchEthUsd(),
        resolveLiveNetworkFees(params.provider),
    ]);

    const { price: ethUsd, source: ethUsdSource } = ethUsdPack;

    let rawEstimate = BigInt(cfg.fastGasLimit);
    if (estimateResult.ok) {
        rawEstimate = estimateResult.gas;
    } else if (params.estimateGas) {
        warnings.push(`Gas estimate failed — using ${cfg.fastGasLimit} (tier pad applied)`);
    } else {
        warnings.push('No calldata to estimate — costs use FAST_GAS_LIMIT (may be low for SeaDrop max mint)');
    }

    const floor = intrinsicGasFloor(calldataForFloor);
    if (rawEstimate < floor) {
        rawEstimate = floor;
        warnings.push(`Raised gas estimate to intrinsic floor (${floor}) for this calldata size`);
    }

    // Preview uses network pad (3%); competitive tiers pad similarly in execution.
    const gasLimit = paddedGasLimit(rawEstimate, 'normal');
    warnings.push('Fees: network = feeHistory (no ×1.15); FCFS = tip floors + Direct');

    const tiers: GasTierOption[] = [];
    const builderEnabled = cfg.builderMintEnabled;

    const tierFees = await Promise.all(
        GAS_TIER_DEFS.map(async def => ({ def, fees: await computeGasFeesForTierAsync(params.provider, def.id) }))
    );

    for (const { def, fees } of tierFees) {
        if (!fees) continue;
        const tierGasLimit = paddedGasLimit(rawEstimate, def.id);
        const boostEth = Math.min(def.builderTipEth, cfg.maxBuilderTipEth);
        const boostWei = priorityBoostWeiFromEth(boostEth);
        const boostEthNum = Number(boostWei) / 1e18;
        const boostedPriority = fees.maxPriorityFeePerGas + (tierGasLimit > 0n ? boostWei / tierGasLimit : 0n);
        const boostedMax = boostedPriority > fees.maxFeePerGas ? boostedPriority : fees.maxFeePerGas;
        const costEth = tierCostEth(tierGasLimit, boostedMax, mintValueWei);
        const costUsd = costEth * ethUsd;
        const totalEth = costEth * params.walletCount;
        const totalUsd = costUsd * params.walletCount;
        const useBuilder = builderEnabled && boostEth > 0;
        // MintDash-aligned: FCFS tiers prefer Direct RPC blast; normal stays public;
        // tip+builder → Flashbots bundle. Delegation is never auto-suggested on Telegram.
        let suggestedInclusionMode: InclusionMode = 'public';
        if (useBuilder) {
            suggestedInclusionMode = 'builder_flashbots';
        } else if (def.id === 'fcfs' || def.id === 'fcfs_plus' || def.id === 'fcfs_max' || def.id === 'overdrive') {
            suggestedInclusionMode = 'private_rpc_direct';
        }

        tiers.push({
            id: def.id,
            label: def.label,
            hint: def.hint,
            gasBribeGwei: fees.gasBribeGwei,
            priorityBoostEth: boostEthNum,
            priorityBoostWei: boostWei.toString(),
            builderTipEth: boostEthNum,
            builderTipWei: boostWei.toString(),
            overdrive: fees.overdrive,
            maxFeeGwei: fees.maxFeeGwei,
            priorityGwei: fees.priorityGwei,
            maxFeePerGasWei: fees.maxFeePerGas.toString(),
            maxPriorityFeePerGasWei: fees.maxPriorityFeePerGas.toString(),
            gasLimit: tierGasLimit.toString(),
            costEthPerWallet: costEth,
            costUsdPerWallet: costUsd,
            totalEth,
            totalUsd,
            suggestedInclusionMode,
        });
    }

    return {
        ethUsd,
        ethUsdSource,
        baseBlockMaxFeeGwei: live.baseMaxFeeGwei,
        baseBlockPriorityGwei: live.basePriorityFeeGwei,
        walletCount: params.walletCount,
        mintValueEth: params.mintValueEth,
        gasLimit: gasLimit.toString(),
        tiers,
        warnings,
    };
}

export function formatGasAdvisorMessage(report: GasAdvisorReport, targetLine: string): string {
    let body =
        `${targetLine}\n` +
        uiRow('Fleet', `<b>${report.walletCount}</b> wallets`) +
        '\n' +
        uiRow('Mint price', `<b>${report.mintValueEth}</b> ETH each`) +
        '\n' +
        uiRow(
            'Network',
            `~<b>${report.baseBlockMaxFeeGwei.toFixed(3)}</b> gwei base · <b>${report.baseBlockPriorityGwei.toFixed(3)}</b> tip`
        ) +
        '\n' +
        uiRow('ETH price', `<b>$${report.ethUsd.toFixed(0)}</b> <i>(${report.ethUsdSource})</i>`) +
        '\n' +
        uiRow('Gas limit', `<b>${report.gasLimit}</b> per tx`) +
        '\n\n<b>Speed tiers</b>';

    for (const t of report.tiers) {
        const boostLine =
            t.priorityBoostEth > 0
                ? ` · boost <b>${t.priorityBoostEth.toFixed(4)}</b> ETH (<b>$${(t.priorityBoostEth * report.ethUsd).toFixed(2)}</b>)`
                : '';
        const route =
            t.suggestedInclusionMode === 'builder_flashbots'
                ? 'Builder'
                : t.suggestedInclusionMode === 'private_rpc_direct'
                  ? 'Direct RPC'
                  : t.suggestedInclusionMode === 'private_rpc'
                    ? 'Protect'
                    : t.suggestedInclusionMode === 'delegation'
                      ? 'Delegation (MintDash)'
                      : 'Public';
        body +=
            `\n\n<b>${t.label}</b> · <i>${route}</i>\n` +
            `<i>${t.hint}</i>\n` +
            `Priority <b>${t.priorityGwei.toFixed(2)}</b> gwei · max <b>${t.maxFeeGwei.toFixed(2)}</b> gwei${boostLine}\n` +
            `Per wallet ~<b>${t.costEthPerWallet.toFixed(5)}</b> ETH (<b>$${t.costUsdPerWallet.toFixed(2)}</b>)\n` +
            `Batch ~<b>${t.totalEth.toFixed(4)}</b> ETH (<b>$${t.totalUsd.toFixed(2)}</b>)`;
    }

    if (report.warnings.length) {
        body += `\n\n⚠️ ${report.warnings.join(' · ')}`;
    }

    const maxBoost = getRuntimeConfig().maxBuilderTipEth;
    return uiScreen({
        icon: '⛽',
        title: 'Gas advisor',
        body,
        footer:
            `<i>EIP-1559 priority fees only. Boost cap ${maxBoost} ETH/wallet. Bundles are not guaranteed.</i>`,
    });
}
