/**
 * Broadcast recipient resolution — union every known Telegram user, not just unlockedUsers.
 */
import type { BotState } from './stateManager';
import { StateManager } from './stateManager';

const TELEGRAM_USER_ID = /^\d+$/;

export interface BroadcastAudience {
    /** Private chat user IDs (numeric Telegram UIDs only). */
    userIds: string[];
    /** Counts for admin feedback. */
    counts: {
        fromUnlocked: number;
        fromWallets: number;
        fromChatMembers: number;
        fromDatabase: number;
        totalUsers: number;
    };
}

/**
 * Everyone who should receive an admin DM broadcast.
 * Previously only `unlockedUsers` was used — most active users only appear in `userWallets`.
 */
export async function resolveBroadcastAudience(state: BotState): Promise<BroadcastAudience> {
    const userIds = new Set<string>();
    let fromUnlocked = 0;
    let fromWallets = 0;
    let fromChatMembers = 0;
    let fromDatabase = 0;

    for (const uid of state.unlockedUsers || []) {
        if (TELEGRAM_USER_ID.test(uid) && userIds.add(uid)) fromUnlocked++;
    }

    for (const uid of Object.keys(state.userWallets || {})) {
        if (TELEGRAM_USER_ID.test(uid) && userIds.add(uid)) fromWallets++;
    }

    for (const uid of state.chatMembers || []) {
        if (TELEGRAM_USER_ID.test(uid) && userIds.add(uid)) fromChatMembers++;
    }

    if (StateManager.isConnected()) {
        const dbUsers = await StateManager.loadAllUsers();
        for (const uid of Object.keys(dbUsers)) {
            if (TELEGRAM_USER_ID.test(uid) && userIds.add(uid)) fromDatabase++;
        }
    }

    return {
        userIds: Array.from(userIds),
        counts: {
            fromUnlocked,
            fromWallets,
            fromChatMembers,
            fromDatabase,
            totalUsers: userIds.size,
        },
    };
}
