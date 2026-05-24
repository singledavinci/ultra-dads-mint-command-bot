import { Transaction } from 'ethers';
import type { BundleSpec } from '../types/inclusion';

/** walletAddress (lower) + nonce → mint tx hash */
export function mintTxHashesByWallet(spec: BundleSpec): Map<string, string> {
    const map = new Map<string, string>();
    for (const entry of spec.txs) {
        if (entry.role === 'coinbase_tip') continue;
        const parsed = Transaction.from(entry.signedTx);
        const hash = parsed.hash;
        if (!hash) continue;
        const key = `${entry.walletAddress.toLowerCase()}:${entry.nonce}`;
        map.set(key, hash);
    }
    return map;
}

export function lookupMintTxHash(
    spec: BundleSpec,
    walletAddress: string,
    nonce: number
): string | undefined {
    return mintTxHashesByWallet(spec).get(`${walletAddress.toLowerCase()}:${nonce}`);
}
