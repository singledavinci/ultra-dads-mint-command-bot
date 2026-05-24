import { Wallet, parseEther, type JsonRpcProvider } from 'ethers';
import { evaluateWalletFunding, formatFundingSkipReason } from './gasCost';
import { getRuntimeConfig, maskAddress } from '../config/runtimeConfig';
import { effectiveSkipRpcPreflight } from '../config/capacityOverrides';
import {
    buildScatterCalldataForWallet,
    ensureScatterErc20Approvals,
    scatterChainSupported,
} from '../services/scatterMint';
import { decodeWhaleMintQuantity, resolveAutomintQuantity, scaleMintValueWei } from '../services/copyMintQuantity';
import { rewriteMintCalldataForWallet, rewriteMintCalldataQuantity } from '../services/calldataRewriter';
import { resolveSeaDropMint } from '../services/seaDropMintResolver';
import { reserveNonce } from './NonceManager';
import { EngineRpcPool } from './RpcPool';
import { DEFERRED_NONCE, GasPlanner } from './GasPlanner';
import { applyExecutionWalletCap } from '../utils/walletExecution';
import type {
    CopyMintEngineOptions,
    DetectedMintCandidate,
    GasPlan,
    PaymentPlan,
    WalletExecutionPlan,
} from '../types/copyMint';

export type PreflightBuildParams = {
    provider: JsonRpcProvider;
    privateKeys: string[];
    candidate: DetectedMintCandidate;
    paymentPlan: PaymentPlan;
    options?: CopyMintEngineOptions;
};

export type PreflightBuildContext = PreflightBuildParams & {
    keys: string[];
    mintValue: bigint;
    totalCap: bigint;
    totalValue: bigint;
    scatterSlug?: string;
    seaDropNft?: string;
    sharedGasPlan: GasPlan | null;
    enforceBalanceGate: boolean;
    gasPreflightForGate: {
        gasReserveWei: bigint;
        gasReserveEth: string;
        worstCaseGasWei: bigint;
        worstCaseGasEth: string;
        effectiveFeePerGas: bigint;
    } | null;
    balanceByIndex: Map<number, bigint | null>;
    ignoreInsufficientBalance: boolean;
};

export class WalletPreflight {
    static async buildPlans(params: PreflightBuildParams): Promise<WalletExecutionPlan[]> {
        const ctx = await WalletPreflight.prepareBuildContext(params);
        const plans: WalletExecutionPlan[] = [];
        for (let i = 0; i < ctx.keys.length; i++) {
            plans.push(await WalletPreflight.buildPlanAtIndex(ctx, i));
        }
        return plans;
    }

    static async prepareBuildContext(params: PreflightBuildParams): Promise<PreflightBuildContext> {
        const cfg = getRuntimeConfig();
        let keys = params.privateKeys;
        const bypassWalletCap = Boolean(params.options?.bypassWalletCap);
        const ignoreInsufficientBalance = Boolean(params.options?.ignoreInsufficientBalance);

        if (cfg.canaryWalletMode) {
            keys = keys.slice(0, cfg.canaryWalletCount);
        }
        if (!bypassWalletCap) {
            const hdCount =
                params.options?.hdWalletKeyCount ??
                (params.options?.importedWalletCount !== undefined
                    ? Math.max(0, keys.length - (params.options.importedWalletCount ?? 0))
                    : keys.length);
            keys = applyExecutionWalletCap(
                keys,
                cfg.maxWalletsPerExecution,
                hdCount,
                params.options?.importedWalletCount
            );
        }

        const scatterSlug = params.options?.scatterSlug?.trim();
        const skipSeaDropRebuild = Boolean(params.options?.skipSeaDropRebuild);
        const seaDropNft = skipSeaDropRebuild
            ? undefined
            : params.options?.seaDropNftContract?.trim();
        const needsPerWalletBuild = Boolean(scatterSlug || seaDropNft || skipSeaDropRebuild);

        let sharedGasPlan: GasPlan | null = null;
        if (effectiveSkipRpcPreflight() && !params.options?.forceGasEstimate && !needsPerWalletBuild) {
            sharedGasPlan = await GasPlanner.planFast({
                provider: params.provider,
                candidate: params.candidate,
                paymentPlan: params.paymentPlan,
                overdrive: params.options?.overdrive,
                gasBribeGwei: params.options?.gasBribeGwei,
                gasTierId: params.options?.gasTierId,
                gasLimitOverride: params.options?.gasLimitOverride,
            });
        }

        const skipUnfunded = process.env.SKIP_UNFUNDED_WALLETS !== 'false';
        const enforceBalanceGate =
            effectiveSkipRpcPreflight() &&
            !params.options?.forceGasEstimate &&
            sharedGasPlan &&
            skipUnfunded &&
            !ignoreInsufficientBalance;

        const gasPreflightForGate = sharedGasPlan
            ? {
                  gasReserveWei: parseEther(sharedGasPlan.estimatedGasCostEth || '0'),
                  gasReserveEth: sharedGasPlan.estimatedGasCostEth || '0',
                  worstCaseGasWei: 0n,
                  worstCaseGasEth: '0',
                  effectiveFeePerGas: 0n,
              }
            : null;

        const balanceByIndex = new Map<number, bigint | null>();
        if (enforceBalanceGate && gasPreflightForGate) {
            await Promise.all(
                keys.map(async (_, bi) => {
                    const wallet = new Wallet(keys[bi], params.provider);
                    const masked = maskAddress(wallet.address);
                    const balance = await WalletPreflight.fetchBalance(
                        params.provider,
                        wallet.address,
                        masked
                    );
                    balanceByIndex.set(bi, balance);
                })
            );
        }

        return {
            ...params,
            keys,
            mintValue: BigInt(params.paymentPlan.selectedValue || '0'),
            totalCap: BigInt(Math.floor(cfg.maxTotalBatchEth * 1e18)),
            totalValue: 0n,
            scatterSlug,
            seaDropNft,
            sharedGasPlan,
            enforceBalanceGate: Boolean(enforceBalanceGate),
            gasPreflightForGate,
            balanceByIndex,
            ignoreInsufficientBalance,
        };
    }

    static async buildPlanAtIndex(ctx: PreflightBuildContext, index: number): Promise<WalletExecutionPlan> {
        const cfg = getRuntimeConfig();
        const wallet = new Wallet(ctx.keys[index], ctx.provider);
        const masked = maskAddress(wallet.address);
        const warnings: string[] = ctx.sharedGasPlan?.warnings ?? [];

        if (effectiveSkipRpcPreflight() && !ctx.options?.forceGasEstimate && ctx.sharedGasPlan && !ctx.options?.skipSeaDropRebuild) {
            if (ctx.enforceBalanceGate && ctx.gasPreflightForGate) {
                const bal = ctx.balanceByIndex.get(index) ?? null;
                if (bal === null) {
                    return WalletPreflight.skipped(
                        index,
                        wallet.address,
                        masked,
                        ctx.keys[index],
                        'Balance check failed (RPC) — retry or set FORCE_GAS_ESTIMATE=false path'
                    );
                }
                const funding = evaluateWalletFunding(bal, ctx.mintValue, ctx.gasPreflightForGate);
                if (!funding.ok) {
                    return WalletPreflight.skipped(
                        index,
                        wallet.address,
                        masked,
                        ctx.keys[index],
                        formatFundingSkipReason(funding, bal, ctx.mintValue, ctx.gasPreflightForGate)
                    );
                }
            }

            const fast = WalletPreflight.buildFastPlan(
                index,
                wallet,
                masked,
                ctx.keys[index],
                ctx,
                ctx.sharedGasPlan,
                ctx.mintValue,
                ctx.totalCap,
                ctx.totalValue,
                ctx.options
            );
            if (fast.plan) {
                ctx.totalValue = fast.totalValue;
                return fast.plan;
            }
            return WalletPreflight.skipped(index, wallet.address, masked, ctx.keys[index], 'Preflight failed');
        }

        const pre = await EngineRpcPool.safePreflight(async () => {
            const [rpcNonce, balance] = await Promise.all([
                ctx.provider.getTransactionCount(wallet.address, 'pending'),
                ctx.provider.getBalance(wallet.address),
            ]);
            return { rpcNonce, balance };
        }, `W#${index + 1}`);

        if (!pre) {
            return WalletPreflight.skipped(
                index,
                wallet.address,
                masked,
                ctx.keys[index],
                'RPC rate limit during preflight'
            );
        }

        let data = ctx.candidate.data;
        let txTo = ctx.options?.executionTo || ctx.candidate.to;
        let txValue = ctx.paymentPlan.selectedValue;

        const scatterWarnings: string[] = [];
        if (ctx.scatterSlug) {
            const scatterTx = await buildScatterCalldataForWallet({
                slug: ctx.scatterSlug,
                walletAddress: wallet.address,
                quantity: ctx.options?.quantity ?? 1,
                affiliateAddress: process.env.SCATTER_AFFILIATE_ADDRESS?.trim(),
            });
            if (!scatterTx) {
                return WalletPreflight.skipped(
                    index,
                    wallet.address,
                    masked,
                    ctx.keys[index],
                    'Scatter: no eligible mint list for this wallet (or unsupported chain)'
                );
            }
            if (!scatterChainSupported(scatterTx.chainId)) {
                return WalletPreflight.skipped(
                    index,
                    wallet.address,
                    masked,
                    ctx.keys[index],
                    `Scatter chain ${scatterTx.chainId} not supported (bot runs Ethereum mainnet)`
                );
            }
            if (scatterTx.erc20Approvals.length) {
                const approval = await ensureScatterErc20Approvals({
                    provider: ctx.provider,
                    signer: wallet,
                    collectionAddress: scatterTx.collectionAddress,
                    erc20s: scatterTx.erc20Approvals,
                });
                scatterWarnings.push(...approval.messages);
                if (!approval.ok) {
                    return WalletPreflight.skipped(
                        index,
                        wallet.address,
                        masked,
                        ctx.keys[index],
                        `Scatter ERC20 approve failed: ${approval.error || 'unknown'}`
                    );
                }
            }
            data = scatterTx.data;
            txTo = scatterTx.to;
            txValue = scatterTx.value;
            scatterWarnings.push(...scatterTx.warnings);
        }

        if (ctx.seaDropNft) {
            let quantity = ctx.options?.quantity ?? 1;
            const whaleTxData = ctx.options?.whaleTxData;
            if (whaleTxData && ctx.options?.quantity) {
                const perWallet = await resolveAutomintQuantity({
                    provider: ctx.provider,
                    walletAddress: wallet.address,
                    mintIntent: {
                        routeType: 'seadrop_public',
                        targetContract: ctx.seaDropNft,
                        quantity: ctx.options.quantity,
                        sourceQuantity: decodeWhaleMintQuantity(whaleTxData),
                    },
                    whaleTxData,
                });
                if (perWallet < 1) {
                    return WalletPreflight.skipped(
                        index,
                        wallet.address,
                        masked,
                        ctx.keys[index],
                        'SeaDrop: wallet mint cap reached (0 remaining)'
                    );
                }
                quantity = perWallet;
            }
            const sea = await resolveSeaDropMint({
                nftContract: ctx.seaDropNft,
                minter: wallet.address,
                quantity,
                provider: ctx.provider,
            });
            if (!sea) {
                return WalletPreflight.skipped(
                    index,
                    wallet.address,
                    masked,
                    ctx.keys[index],
                    'SeaDrop: no eligible phase for this wallet (GTD/public/signed)'
                );
            }
            data = sea.data;
            txTo = sea.to;
            txValue = sea.value;
            scatterWarnings.push(...sea.warnings);
        } else if (ctx.options?.skipSeaDropRebuild && ctx.options?.whaleTxData) {
            let quantity = ctx.options?.quantity ?? 1;
            const whaleTxData = ctx.options.whaleTxData;
            const nftContract = ctx.options?.seaDropNftContract?.trim() || ctx.candidate.target || '';
            if (nftContract) {
                const perWallet = await resolveAutomintQuantity({
                    provider: ctx.provider,
                    walletAddress: wallet.address,
                    mintIntent: {
                        routeType: 'seadrop_public',
                        targetContract: nftContract,
                        quantity: ctx.options.quantity ?? 1,
                        sourceQuantity: decodeWhaleMintQuantity(whaleTxData),
                    },
                    whaleTxData,
                });
                if (perWallet < 1) {
                    return WalletPreflight.skipped(
                        index,
                        wallet.address,
                        masked,
                        ctx.keys[index],
                        'SeaDrop: wallet mint cap reached (0 remaining)'
                    );
                }
                quantity = perWallet;
            }
            const leadQty = ctx.options?.quantity ?? 1;
            if (quantity !== leadQty) {
                try {
                    const unitWei = BigInt(ctx.paymentPlan.selectedValue || '0') / BigInt(leadQty);
                    txValue = (unitWei * BigInt(quantity)).toString();
                } catch {
                    txValue = scaleMintValueWei(ctx.paymentPlan.selectedValue, quantity);
                }
            }
            if (quantity !== (decodeWhaleMintQuantity(data) || leadQty)) {
                const scaled = rewriteMintCalldataQuantity(
                    data,
                    quantity,
                    decodeWhaleMintQuantity(data) || leadQty
                );
                if (scaled) data = scaled;
            }
        }

        const nonce = reserveNonce(wallet.address, pre.rpcNonce);

        data = WalletPreflight.calldataForWallet(
            data,
            wallet.address,
            ctx.options?.whaleAddress,
            ctx.options?.quantity
        );

        const candidateForWallet = { ...ctx.candidate, to: txTo, data };
        const paymentForWallet = { ...ctx.paymentPlan, selectedValue: txValue };
        const gasPlan = await GasPlanner.plan({
            provider: ctx.provider,
            candidate: candidateForWallet,
            paymentPlan: paymentForWallet,
            walletAddress: wallet.address,
            overdrive: ctx.options?.overdrive,
            gasBribeGwei: ctx.options?.gasBribeGwei,
            gasTierId: ctx.options?.gasTierId,
            gasLimitOverride: ctx.options?.gasLimitOverride,
            forceGasEstimate:
                ctx.options?.forceGasEstimate || Boolean(ctx.seaDropNft) || Boolean(ctx.scatterSlug),
            mirrorWhaleGas: ctx.options?.mirrorWhaleGas,
        });

        const required = parseEther(gasPlan.requiredBalanceEth);
        const walletMintValue = BigInt(txValue || '0');
        const gasPreflight = {
            gasReserveWei: parseEther(gasPlan.estimatedGasCostEth || '0'),
            gasReserveEth: gasPlan.estimatedGasCostEth || '0',
            worstCaseGasWei: 0n,
            worstCaseGasEth: '0',
            effectiveFeePerGas: 0n,
        };

        if (ctx.options?.maxMintLimit && !ctx.options.disableMaxMint) {
            const maxEth = parseFloat(ctx.options.maxMintLimit);
            if (maxEth > 0 && Number(walletMintValue) / 1e18 > maxEth) {
                return WalletPreflight.skipped(
                    index,
                    wallet.address,
                    masked,
                    ctx.keys[index],
                    `Exceeds max mint ${maxEth} ETH`
                );
            }
        }

        const funding = evaluateWalletFunding(pre.balance, walletMintValue, gasPreflight);
        if (!funding.ok && !ctx.ignoreInsufficientBalance) {
            return WalletPreflight.skipped(
                index,
                wallet.address,
                masked,
                ctx.keys[index],
                formatFundingSkipReason(funding, pre.balance, walletMintValue, gasPreflight)
            );
        }

        if (ctx.totalValue + walletMintValue > ctx.totalCap) {
            return WalletPreflight.skipped(
                index,
                wallet.address,
                masked,
                ctx.keys[index],
                'MAX_TOTAL_BATCH_ETH cap'
            );
        }
        ctx.totalValue += walletMintValue;

        return {
            walletIndex: index,
            walletAddress: wallet.address,
            maskedWalletAddress: masked,
            privateKey: ctx.keys[index],
            nonce,
            to: txTo,
            data,
            value: txValue,
            gasLimit: gasPlan.gasLimit,
            maxFeePerGas: gasPlan.maxFeePerGas,
            maxPriorityFeePerGas: gasPlan.maxPriorityFeePerGas,
            requiredBalance: required,
            balance: pre.balance,
            shortage: 0n,
            canBroadcast: true,
            warnings: [...warnings, ...scatterWarnings],
        };
    }

    private static buildFastPlan(
        index: number,
        wallet: Wallet,
        masked: string,
        pk: string,
        params: {
            candidate: DetectedMintCandidate;
            paymentPlan: PaymentPlan;
            options?: CopyMintEngineOptions;
        },
        gasPlan: GasPlan,
        mintValue: bigint,
        totalCap: bigint,
        totalValue: bigint,
        options?: CopyMintEngineOptions
    ): { plan: WalletExecutionPlan | null; totalValue: bigint } {
        if (options?.maxMintLimit && !options.disableMaxMint) {
            const maxEth = parseFloat(options.maxMintLimit);
            if (maxEth > 0 && Number(mintValue) / 1e18 > maxEth) {
                return {
                    plan: WalletPreflight.skipped(
                        index,
                        wallet.address,
                        masked,
                        pk,
                        `Exceeds max mint ${maxEth} ETH`
                    ),
                    totalValue,
                };
            }
        }

        if (totalValue + mintValue > totalCap) {
            return {
                plan: WalletPreflight.skipped(index, wallet.address, masked, pk, 'MAX_TOTAL_BATCH_ETH cap'),
                totalValue,
            };
        }

        const data = WalletPreflight.calldataForWallet(
            params.candidate.data,
            wallet.address,
            options?.whaleAddress,
            options?.quantity
        );

        return {
            totalValue: totalValue + mintValue,
            plan: {
                walletIndex: index,
                walletAddress: wallet.address,
                maskedWalletAddress: masked,
                privateKey: pk,
                nonce: DEFERRED_NONCE,
                to: params.candidate.to,
                data,
                value: params.paymentPlan.selectedValue,
                gasLimit: gasPlan.gasLimit,
                maxFeePerGas: gasPlan.maxFeePerGas,
                maxPriorityFeePerGas: gasPlan.maxPriorityFeePerGas,
                requiredBalance: 0n,
                balance: 0n,
                shortage: 0n,
                canBroadcast: true,
                warnings: gasPlan.warnings,
            },
        };
    }

    /** Same strategy as manual /mint: hijack whale SeaDrop calldata to each sub-wallet. */
    private static calldataForWallet(
        data: string,
        walletAddress: string,
        whaleAddress?: string,
        quantity?: number
    ): string {
        let out = data;
        if (whaleAddress?.startsWith('0x')) {
            const rewritten = rewriteMintCalldataForWallet(out, whaleAddress, walletAddress);
            if (rewritten) out = rewritten;
        }
        const qty = quantity ?? 1;
        if (qty > 1) {
            const whaleQty = decodeWhaleMintQuantity(out) || 1;
            if (qty !== whaleQty) {
                const scaled = rewriteMintCalldataQuantity(out, qty, whaleQty);
                if (scaled) out = scaled;
            }
        }
        return out;
    }

    private static async fetchBalance(
        provider: JsonRpcProvider,
        address: string,
        masked: string
    ): Promise<bigint | null> {
        let bal = await EngineRpcPool.safePreflight(
            () => provider.getBalance(address),
            `balance/${masked}`
        );
        if (bal !== null) return bal;
        await new Promise(r => setTimeout(r, 120));
        bal = await EngineRpcPool.safePreflight(
            () => provider.getBalance(address),
            `balance-retry/${masked}`
        );
        return bal;
    }

    private static skipped(
        index: number,
        address: string,
        masked: string,
        pk: string,
        reason: string
    ): WalletExecutionPlan {
        return {
            walletIndex: index,
            walletAddress: address,
            maskedWalletAddress: masked,
            privateKey: pk,
            nonce: 0,
            to: '',
            data: '0x',
            value: '0x0',
            gasLimit: 0n,
            maxFeePerGas: 0n,
            maxPriorityFeePerGas: 0n,
            requiredBalance: 0n,
            balance: 0n,
            shortage: 0n,
            canBroadcast: false,
            skipReason: reason,
            warnings: [],
        };
    }
}
