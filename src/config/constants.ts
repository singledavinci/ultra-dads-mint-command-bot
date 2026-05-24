/**
 * Single source of truth for known marketplace/router contract addresses.
 *
 * Previously these arrays existed in three places (mintCore.ts, trackerCore.ts,
 * src/bot/index.ts) with overlapping but inconsistent membership. Always import
 * from here and add new entries here only.
 *
 * Addresses are intentionally lowercase. Comparators must lowercase the input.
 */

/** Routers we should never let users target directly via /mint. */
export const KNOWN_NFT_ROUTERS: readonly string[] = [
    '0x00005ea00ac477b1030ce78506496e8c2de24bf5', // OpenSea SeaDrop v1.0
    '0x0000000000664ceffed39244a8312556a900b938', // OpenSea SeaDrop v1.1
    '0x00000000000001ad428e4906ae943a6d5e6f53d3', // OpenSea Seaport 1.4
    '0x00000000000000adc04c56bf30ac9d3c0aaf14dc', // OpenSea Seaport 1.5
    '0x4d224452801aced8b2f0aebe155379bb5d594381', // ApeCoin NFT Mint Router
] as const;

/** Subset of routers where the tracker should bypass log-based mint detection. */
export const TRACKER_BYPASS_ROUTERS: readonly string[] = [
    '0x00005ea00ac477b1030ce78506496e8c2de24bf5',
    '0x0000000000664ceffed39244a8312556a900b938',
] as const;

export function isKnownRouter(addr: string | null | undefined): boolean {
    if (!addr) return false;
    return KNOWN_NFT_ROUTERS.includes(addr.toLowerCase());
}

export function isTrackerBypassRouter(addr: string | null | undefined): boolean {
    if (!addr) return false;
    return TRACKER_BYPASS_ROUTERS.includes(addr.toLowerCase());
}
