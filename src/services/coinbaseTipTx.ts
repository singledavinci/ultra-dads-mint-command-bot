/**
 * Optional coinbase payment via audited helper contract (Bundle v2).
 * Requires BUILDER_COINBASE_CONTRACT — see docs/BUNDLE_MECHANICS_SPEC.md.
 */

import { Wallet, parseUnits, type JsonRpcProvider } from 'ethers';
import { getRuntimeConfig } from '../config/runtimeConfig';
import { reserveNonce } from './nonceManager';
import { getChainId } from './builderPayment';
import type { SignedBundleTx } from '../types/inclusion';
import type { WalletExecutionPlan } from '../types/copyMint';

export function coinbaseTipEnabled(): boolean {
    const addr = getRuntimeConfig().builderCoinbaseContract?.trim();
    return Boolean(addr && /^0x[a-fA-F0-9]{40}$/i.test(addr));
}

export function coinbaseTipWei(): bigint {
    const cfg = getRuntimeConfig();
    if (!coinbaseTipEnabled()) return 0n;
    const eth = cfg.builderDefaultTipEth;
    if (eth <= 0) return 0n;
    return parseUnits(eth.toFixed(9).replace(/\.?0+$/, ''), 'ether');
}

/**
 * Sign a payable call to the helper contract from the first bundle wallet (nonce+1).
 */
export async function signCoinbaseTipTx(
    provider: JsonRpcProvider,
    payer: WalletExecutionPlan
): Promise<SignedBundleTx | null> {
    const cfg = getRuntimeConfig();
    const to = cfg.builderCoinbaseContract?.trim().toLowerCase();
    const value = coinbaseTipWei();
    if (!to || value <= 0n) return null;

    const data = cfg.builderCoinbaseCalldata?.trim() || '0x';
    const chainId = await getChainId(provider);
    const tipNonce = reserveNonce(payer.walletAddress, payer.nonce + 1);

    const wallet = new Wallet(payer.privateKey, provider);
    const signedTx = await wallet.signTransaction({
        to,
        data,
        value,
        nonce: tipNonce,
        gasLimit: 55_000n,
        maxFeePerGas: payer.maxFeePerGas,
        maxPriorityFeePerGas: payer.maxPriorityFeePerGas,
        chainId,
        type: 2,
    });

    return {
        signedTx,
        walletAddress: payer.walletAddress,
        nonce: tipNonce,
        role: 'coinbase_tip',
    };
}
