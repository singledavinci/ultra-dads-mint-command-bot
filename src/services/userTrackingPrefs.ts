import type { BotState } from '../bot/stateManager';

/** Which copy-mints automint may execute for this user. */
export type CopyMintPaymentFilter = 'free_only' | 'all';

export type UserTrackingPrefs = {
    alertPersonal: boolean;
    alertGlobal: boolean;
    alertCommunity: boolean;
    autoMintPersonal: boolean;
    autoMintGlobal: boolean;
    autoMintCommunity: boolean;
    /** Default `all` — copy free and paid whale mints. */
    copyMintPaymentFilter: CopyMintPaymentFilter;
};

const PAYMENT_ALL: CopyMintPaymentFilter = 'all';

export const TRACKING_PRESET_PERSONAL_ONLY: UserTrackingPrefs = {
    alertPersonal: true,
    alertGlobal: false,
    alertCommunity: false,
    autoMintPersonal: true,
    autoMintGlobal: false,
    autoMintCommunity: false,
    copyMintPaymentFilter: PAYMENT_ALL,
};

export const TRACKING_PRESET_GLOBAL_AND_PERSONAL: UserTrackingPrefs = {
    alertPersonal: true,
    alertGlobal: true,
    alertCommunity: false,
    autoMintPersonal: true,
    autoMintGlobal: true,
    autoMintCommunity: false,
    copyMintPaymentFilter: PAYMENT_ALL,
};

export const TRACKING_PRESET_ALL_SOURCES: UserTrackingPrefs = {
    alertPersonal: true,
    alertGlobal: true,
    alertCommunity: true,
    autoMintPersonal: true,
    autoMintGlobal: true,
    autoMintCommunity: true,
    copyMintPaymentFilter: PAYMENT_ALL,
};

export const TRACKING_PRESET_ALERTS_ONLY_PERSONAL: UserTrackingPrefs = {
    alertPersonal: true,
    alertGlobal: false,
    alertCommunity: false,
    autoMintPersonal: false,
    autoMintGlobal: false,
    autoMintCommunity: false,
    copyMintPaymentFilter: PAYMENT_ALL,
};

function whaleInList(list: string[] | undefined, whaleLower: string): boolean {
    return (list || []).some(a => a.toLowerCase() === whaleLower);
}

export function isWhaleGloballyTracked(state: BotState, whaleLower: string): boolean {
    return (state.trackedAddresses || []).some(a => a.toLowerCase() === whaleLower);
}

export function isWhaleFromCommunityPool(state: BotState, whaleLower: string, uid: string): boolean {
    if (whaleInList(state.userTrackedAddresses?.[uid], whaleLower)) return false;
    for (const [otherUid, list] of Object.entries(state.userTrackedAddresses || {})) {
        if (otherUid === uid) continue;
        if (whaleInList(list, whaleLower)) return true;
    }
    return false;
}

export function getUserTrackingPrefs(state: BotState, uid: string): UserTrackingPrefs {
    const stored = state.userTrackingPrefs?.[uid];
    const followGlobalLegacy = state.userFollowGlobal?.[uid] !== false;

    const paymentStored = (stored as { copyMintPaymentFilter?: CopyMintPaymentFilter } | undefined)
        ?.copyMintPaymentFilter;

    return {
        alertPersonal: stored?.alertPersonal ?? true,
        alertGlobal: stored?.alertGlobal ?? followGlobalLegacy,
        alertCommunity: stored?.alertCommunity ?? false,
        autoMintPersonal: stored?.autoMintPersonal ?? true,
        autoMintGlobal: stored?.autoMintGlobal ?? followGlobalLegacy,
        autoMintCommunity: stored?.autoMintCommunity ?? false,
        copyMintPaymentFilter: paymentStored === 'free_only' ? 'free_only' : 'all',
    };
}

export function userAllowsAutomintPayment(
    mintType: 'free' | 'paid' | 'unknown',
    filter: CopyMintPaymentFilter
): boolean {
    if (filter === 'all') return true;
    return mintType === 'free';
}

export function applyUserTrackingPrefs(
    state: BotState,
    uid: string,
    patch: Partial<UserTrackingPrefs>
): UserTrackingPrefs {
    if (!state.userTrackingPrefs) state.userTrackingPrefs = {};
    const next = { ...getUserTrackingPrefs(state, uid), ...patch };
    state.userTrackingPrefs[uid] = next;
    if (!state.userFollowGlobal) state.userFollowGlobal = {};
    state.userFollowGlobal[uid] = next.alertGlobal && next.autoMintGlobal;
    return next;
}

export function classifyWhaleForUser(
    state: BotState,
    uid: string,
    whaleLower: string
): 'personal' | 'global' | 'community' | 'none' {
    if (whaleInList(state.userTrackedAddresses?.[uid], whaleLower)) return 'personal';
    if (isWhaleGloballyTracked(state, whaleLower)) return 'global';
    if (isWhaleFromCommunityPool(state, whaleLower, uid)) return 'community';
    return 'none';
}

export function userWantsWhaleAlert(state: BotState, uid: string, whaleLower: string): boolean {
    const prefs = getUserTrackingPrefs(state, uid);
    const kind = classifyWhaleForUser(state, uid, whaleLower);
    if (kind === 'personal') return prefs.alertPersonal;
    if (kind === 'global') return prefs.alertGlobal;
    if (kind === 'community') return prefs.alertCommunity;
    return false;
}

export function userWantsWhaleAutomint(state: BotState, uid: string, whaleLower: string): boolean {
    const prefs = getUserTrackingPrefs(state, uid);
    const kind = classifyWhaleForUser(state, uid, whaleLower);
    if (kind === 'personal') return prefs.autoMintPersonal;
    if (kind === 'global') return prefs.autoMintGlobal;
    if (kind === 'community') return prefs.autoMintCommunity;
    return false;
}

export function getUsersForWhaleAlerts(state: BotState, whaleLower: string): string[] {
    const uids = new Set<string>();
    Object.keys(state.userWallets || {}).forEach(id => uids.add(id));
    Object.keys(state.userTrackedAddresses || {}).forEach(id => uids.add(id));
    Object.keys(state.userTrackingPrefs || {}).forEach(id => uids.add(id));
    return Array.from(uids).filter(uid => userWantsWhaleAlert(state, uid, whaleLower));
}

export function getUsersForWhaleAutomint(state: BotState, whaleLower: string): string[] {
    if (!state.autoMint) return [];
    const uids = new Set<string>();
    Object.keys(state.userWallets || {}).forEach(id => uids.add(id));
    Object.keys(state.userTrackedAddresses || {}).forEach(id => uids.add(id));
    Object.keys(state.userTrackingPrefs || {}).forEach(id => uids.add(id));
    return Array.from(uids).filter(uid => userWantsWhaleAutomint(state, uid, whaleLower));
}

export function formatPrefsSummary(prefs: UserTrackingPrefs): string {
    const dot = (v: boolean) => (v ? '●' : '○');
    const payment =
        prefs.copyMintPaymentFilter === 'free_only'
            ? 'Free mints only'
            : 'Free + paid mints';
    return (
        `<b>Alerts</b>  You ${dot(prefs.alertPersonal)}  Global ${dot(prefs.alertGlobal)}  Community ${dot(prefs.alertCommunity)}\n` +
        `<b>Auto-mint</b>  You ${dot(prefs.autoMintPersonal)}  Global ${dot(prefs.autoMintGlobal)}  Community ${dot(prefs.autoMintCommunity)}\n` +
        `<b>Copy-mint</b>  ${payment}`
    );
}