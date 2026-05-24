/**
 * Access code gate — /setcode, /unlock, and middleware share one policy.
 *
 * - Bot open (no accessCode): everyone may use the bot.
 * - Bot locked: admin always; users in unlockedUsers after /unlock with current code.
 * - Rotating /setcode clears all unlocks — everyone must /unlock again (subscription model).
 * - /lockuser adds revokedUsers (blocks until successful /unlock clears revoke).
 */
import type { BotState } from './stateManager';

const TELEGRAM_USER_ID = /^\d+$/;

export function normalizeAccessCode(code: string): string {
    return code.trim();
}

export function accessCodesMatch(entered: string, stored: string | undefined): boolean {
    if (!stored) return false;
    return normalizeAccessCode(entered) === normalizeAccessCode(stored);
}

export function isUserRevoked(state: BotState, userId: string): boolean {
    return (state.revokedUsers || []).includes(userId);
}

/**
 * Whether this Telegram user may run bot commands while the lock is active.
 */
export function userCanUseBot(state: BotState, userId: string | undefined, adminUserId: string): boolean {
    if (!userId || !TELEGRAM_USER_ID.test(userId)) return false;
    if (userId === adminUserId) return true;
    if (isUserRevoked(state, userId)) return false;
    if (!state.accessCode?.trim()) return true;
    return state.unlockedUsers?.includes(userId) ?? false;
}

/** Everyone who should lose unlock when the access code changes. */
export function collectKnownUserIds(state: BotState, adminUserId: string): string[] {
    const ids = new Set<string>();
    for (const uid of state.unlockedUsers || []) {
        if (TELEGRAM_USER_ID.test(uid) && uid !== adminUserId) ids.add(uid);
    }
    for (const uid of Object.keys(state.userWallets || {})) {
        if (TELEGRAM_USER_ID.test(uid) && uid !== adminUserId) ids.add(uid);
    }
    for (const uid of Object.keys(state.importedWallets || {})) {
        if (TELEGRAM_USER_ID.test(uid) && uid !== adminUserId) ids.add(uid);
    }
    return Array.from(ids);
}

/** Clear in-memory unlocks when admin sets or rotates the code. */
export function invalidateAllUnlocks(
    state: BotState,
    adminUserId: string
): { clearedUnlocks: number; affectedUserIds: string[] } {
    const affectedUserIds = collectKnownUserIds(state, adminUserId);
    const clearedUnlocks = (state.unlockedUsers || []).filter(id => id !== adminUserId).length;
    state.unlockedUsers = [];
    return { clearedUnlocks, affectedUserIds };
}

export function grantUserUnlock(state: BotState, userId: string): void {
    if (!state.unlockedUsers) state.unlockedUsers = [];
    if (!state.unlockedUsers.includes(userId)) {
        state.unlockedUsers.push(userId);
    }
    if (state.revokedUsers?.length) {
        state.revokedUsers = state.revokedUsers.filter(id => id !== userId);
    }
}

export function revokeUserAccess(state: BotState, userId: string): void {
    if (!state.revokedUsers) state.revokedUsers = [];
    if (!state.revokedUsers.includes(userId)) {
        state.revokedUsers.push(userId);
    }
    if (state.unlockedUsers?.length) {
        state.unlockedUsers = state.unlockedUsers.filter(id => id !== userId);
    }
}
