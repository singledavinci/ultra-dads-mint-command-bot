import { getAddress, isAddress } from 'ethers';

/** Lowercase address for Set/Map matching. */
export function normalizeTrackedWallet(addr: string): string {
    if (!addr?.startsWith('0x')) return addr?.toLowerCase() ?? '';
    try {
        return getAddress(addr).toLowerCase();
    } catch {
        return addr.toLowerCase();
    }
}

/** Checksummed address for display and on-chain calls. */
export function displayTrackedWallet(addr: string): string {
    if (!isAddress(addr)) return addr;
    return getAddress(addr);
}

export function isTracked(addr: string, set: Set<string>): boolean {
    return set.has(normalizeTrackedWallet(addr));
}
