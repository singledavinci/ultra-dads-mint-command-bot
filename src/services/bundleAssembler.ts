import { Wallet, type JsonRpcProvider } from 'ethers';
import { boostedFeesForPlan } from './bundleBudget';
import { coinbaseTipEnabled, signCoinbaseTipTx } from './coinbaseTipTx';
import { getChainId } from './builderPayment';
import type { BundleSpec, SignedBundleTx } from '../types/inclusion';
import type { WalletExecutionPlan } from '../types/copyMint';

export interface AssembleMintBundleParams {
    provider: JsonRpcProvider;
    plans: WalletExecutionPlan[];
    /** Extra EIP-1559 priority budget (wei) applied per mint tx — NOT a coinbase transfer */
    priorityBoostWei?: bigint;
    targetBlock?: number;
}

/**
 * Sign mint txs with strict nonce ordering. Priority boost raises maxPriorityFeePerGas only.
 */
export async function assembleMintBundle(params: AssembleMintBundleParams): Promise<BundleSpec> {
    const provider = params.provider;
    const blockNumber = await provider.getBlockNumber();
    const targetBlock = params.targetBlock ?? blockNumber + 1;
    const chainId = await getChainId(provider);
    const boost = params.priorityBoostWei ?? 0n;

    const sorted = [...params.plans]
        .filter(p => p.canBroadcast)
        .sort((a, b) => {
            const addrCmp = a.walletAddress.localeCompare(b.walletAddress);
            if (addrCmp !== 0) return addrCmp;
            return a.nonce - b.nonce;
        });

    const txs: SignedBundleTx[] = [];

    for (const plan of sorted) {
        const wallet = new Wallet(plan.privateKey, provider);
        const fees = boostedFeesForPlan(plan, boost);
        const signedTx = await wallet.signTransaction({
            to: plan.to,
            data: plan.data,
            value: BigInt(plan.value || '0'),
            nonce: plan.nonce,
            gasLimit: plan.gasLimit,
            maxFeePerGas: fees.maxFeePerGas,
            maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
            chainId,
            type: 2,
        });
        txs.push({
            signedTx,
            walletAddress: plan.walletAddress,
            nonce: plan.nonce,
            role: 'mint',
        });
    }

    if (coinbaseTipEnabled() && sorted.length > 0) {
        const tip = await signCoinbaseTipTx(provider, sorted[0]!);
        if (tip) txs.push(tip);
    }

    return { txs, targetBlock };
}

export function bundleHasCoinbaseTip(spec: BundleSpec): boolean {
    return spec.txs.some(t => t.role === 'coinbase_tip');
}

/** Sort signed txs by (address, nonce) for bundle submission. */
export function orderBundleTxs(txs: SignedBundleTx[]): string[] {
    return [...txs]
        .sort((a, b) => {
            const addrCmp = a.walletAddress.localeCompare(b.walletAddress);
            if (addrCmp !== 0) return addrCmp;
            return a.nonce - b.nonce;
        })
        .map(t => t.signedTx);
}
