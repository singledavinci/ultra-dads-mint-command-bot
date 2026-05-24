/**
 * Wallet selection for copy-mint execution.
 * getUserWallets() returns [active HD keys…, then imported keys].
 * A naive slice(0, max) drops imported wallets when the user has many subs.
 */
export function applyExecutionWalletCap(
    privateKeys: string[],
    maxWallets: number,
    hdWalletKeyCount = 0,
    /** @deprecated Prefer hdWalletKeyCount — trailing imported count (fallback). */
    importedWalletCount?: number
): string[] {
    if (privateKeys.length <= maxWallets) return privateKeys;

    const hdCount = resolveHdKeyCount(privateKeys.length, hdWalletKeyCount, importedWalletCount);
    const hdKeys = privateKeys.slice(0, hdCount);
    const importedKeys = privateKeys.slice(hdCount);
    const hdCap = Math.max(0, maxWallets - importedKeys.length);
    return [...hdKeys.slice(0, hdCap), ...importedKeys];
}

function resolveHdKeyCount(
    totalKeys: number,
    hdWalletKeyCount: number,
    importedWalletCount?: number
): number {
    if (hdWalletKeyCount > 0) {
        return Math.min(Math.max(0, hdWalletKeyCount), totalKeys);
    }
    if (importedWalletCount !== undefined && importedWalletCount >= 0) {
        const imported = Math.min(Math.max(0, importedWalletCount), totalKeys);
        return totalKeys - imported;
    }
    return totalKeys;
}
