/** Bot execution target — Ethereum mainnet only (Phase 3+). */
export const ETH_MAINNET_CHAIN_ID = 1;

export function isEthereumChainSlug(slug: string): boolean {
    const s = slug.toLowerCase();
    return s === 'ethereum' || s === 'eth' || s === 'mainnet' || s === 'homestead';
}

export function isEthereumChainId(chainId: number): boolean {
    return chainId === ETH_MAINNET_CHAIN_ID;
}
