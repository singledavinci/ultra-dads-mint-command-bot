/**
 * After a wallet successfully confirms a mint on a contract, block automint retries
 * for that wallet+contract (e.g. when a second whale mints the same drop).
 */

const store = new Map<string, number>();

function walletContractKey(walletAddress: string, contractAddress: string): string {
    return `${walletAddress.toLowerCase()}:${contractAddress.toLowerCase()}`;
}

/** TTL for success dedupe. Default 24h. Set AUTOMINT_SUCCESS_DEDUPE=false to disable. */
export function readSuccessDedupeTtlMs(): number {
    if (process.env.AUTOMINT_SUCCESS_DEDUPE === 'false') return 0;
    const raw = process.env.AUTOMINT_SUCCESS_DEDUPE_TTL_MS;
    if (raw === '0') return 0;
    const fallback = parseInt(process.env.DEDUPE_TTL_MS || '86400000', 10);
    const n = parseInt(raw || String(fallback), 10);
    return Number.isFinite(n) && n > 0 ? n : 86400000;
}

export function isAutomintSuccessDedupeEnabled(): boolean {
    return readSuccessDedupeTtlMs() > 0;
}

function prune(): void {
    const ttl = readSuccessDedupeTtlMs();
    if (ttl <= 0) return;
    const now = Date.now();
    for (const [key, ts] of store) {
        if (now - ts >= ttl) store.delete(key);
    }
}

/** True when this wallet already confirmed a mint on this contract within TTL. */
export function hasSuccessfulWalletMint(walletAddress: string, contractAddress: string): boolean {
    if (!isAutomintSuccessDedupeEnabled()) return false;
    const contract = contractAddress?.trim();
    const wallet = walletAddress?.trim();
    if (!contract?.startsWith('0x') || !wallet?.startsWith('0x')) return false;
    prune();
    const ts = store.get(walletContractKey(wallet, contract));
    if (!ts) return false;
    const ttl = readSuccessDedupeTtlMs();
    if (Date.now() - ts >= ttl) {
        store.delete(walletContractKey(wallet, contract));
        return false;
    }
    return true;
}

/** Record on-chain success (call from confirmation monitor only). */
export function markSuccessfulWalletMint(walletAddress: string, contractAddress: string): void {
    if (!isAutomintSuccessDedupeEnabled()) return;
    const contract = contractAddress?.trim();
    const wallet = walletAddress?.trim();
    if (!contract?.startsWith('0x') || !wallet?.startsWith('0x')) return;
    store.set(walletContractKey(wallet, contract), Date.now());
}

/** Filter fleet to wallets that have not yet confirmed a mint on this contract. */
export function filterWalletsForAutomint<T extends { address: string }>(
    wallets: T[],
    contractAddress: string
): T[] {
    if (!isAutomintSuccessDedupeEnabled()) return wallets;
    return wallets.filter(w => !hasSuccessfulWalletMint(w.address, contractAddress));
}

export function successDedupeSize(): number {
    prune();
    return store.size;
}

/** Tests only */
export function resetSuccessfulMintDedupeForTests(): void {
    store.clear();
}
