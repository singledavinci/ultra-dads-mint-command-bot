/**
 * Parallel eth_sendRawTransaction race — first successful ack wins (MintDash rawBlast style).
 */

import type { TransactionRequest, Wallet } from 'ethers';
import { getRuntimeConfig } from '../../config/runtimeConfig';
import { resolveExecutionUrls } from '../../config/rpcEndpoints';

export type BlastResult = {
    hash: string;
    rpcUrl: string;
};

/**
 * Sign once, broadcast the same raw tx to many RPC URLs in parallel.
 * Returns the first successful hash; other in-flight sends are ignored.
 */
export async function blastSignedRawTransaction(params: {
    wallet: Wallet;
    tx: TransactionRequest;
    rpcUrls: string[];
    timeoutMs?: number;
}): Promise<BlastResult> {
    const { wallet, tx, timeoutMs = 12_000 } = params;
    const urls = [...new Set(params.rpcUrls.map(u => u.trim()).filter(Boolean))];
    if (urls.length === 0) {
        throw new Error('No blast RPC URLs configured');
    }

    const signed = await wallet.signTransaction(tx);
    if (urls.length === 1) {
        const hash = await sendRaw(urls[0]!, signed, timeoutMs);
        return { hash, rpcUrl: urls[0]! };
    }

    return await Promise.any(
        urls.map(async rpcUrl => {
            const hash = await sendRaw(rpcUrl, signed, timeoutMs);
            return { hash, rpcUrl };
        })
    );
}

async function sendRaw(rpcUrl: string, signedTx: string, timeoutMs: number): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(rpcUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'eth_sendRawTransaction',
                params: [signedTx],
            }),
            signal: controller.signal,
        });
        const json = (await res.json()) as {
            result?: string;
            error?: { message?: string; code?: number };
        };
        if (json.error?.message) {
            throw new Error(json.error.message);
        }
        if (!json.result || typeof json.result !== 'string') {
            throw new Error('eth_sendRawTransaction returned empty result');
        }
        return json.result;
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Private / Protect endpoints accept eth_sendRawTransaction but do NOT gossip
 * to the public mempool. If they win a Promise.any blast race, txs sit pending
 * on Flashbots forever (Etherscan: "made through Flashbots…").
 */
export function isPrivateMempoolRpcUrl(url: string): boolean {
    const u = (url || '').toLowerCase();
    if (!u) return false;
    return (
        u.includes('rpc.flashbots.net') ||
        u.includes('protect') ||
        u.includes('rpc.mevblocker.io') ||
        u.includes('rpc.payload.de') ||
        u.includes('rpc.beaverbuild.org') ||
        u.includes('rsync-builder') ||
        u.includes('rpc.titanbuilder') ||
        (u.includes('builder') && u.includes('relay'))
    );
}

/** Execution + backup RPCs (+ optional extras) for MintDash-style public blast. */
export function resolveBlastRpcUrls(extras?: string[]): string[] {
    const cfg = getRuntimeConfig();
    const fromEnv = resolveExecutionUrls();
    const fromCfg = [...cfg.providerUrls, ...cfg.backupRpcUrls];
    const urls = [...fromEnv, ...fromCfg, ...(extras || [])];
    return [
        ...new Set(
            urls
                .map(u => u.trim())
                .filter(Boolean)
                .filter(u => !isPrivateMempoolRpcUrl(u))
        ),
    ];
}
