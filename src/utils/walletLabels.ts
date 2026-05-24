import type { BotState } from '../bot/stateManager';

const MAX_LABEL_LEN = 32;

export function ensureWalletLabels(state: BotState, userId: string): string[] {
    if (!state.userWalletLabels) state.userWalletLabels = {};
    if (!state.userWalletLabels[userId]) state.userWalletLabels[userId] = [];
    return state.userWalletLabels[userId];
}

/** Display name for wallet index (0-based). Custom label or W#N fallback. */
export function getWalletDisplayName(state: BotState, userId: string | undefined, index: number): string {
    if (!userId) return `W#${index + 1}`;
    const custom = state.userWalletLabels?.[userId]?.[index]?.trim();
    return custom || `W#${index + 1}`;
}

export function setWalletLabel(state: BotState, userId: string, index: number, label: string): void {
    const arr = ensureWalletLabels(state, userId);
    while (arr.length <= index) arr.push('');
    arr[index] = label.trim().slice(0, MAX_LABEL_LEN);
}

export function trimWalletLabels(state: BotState, userId: string, newCount: number): void {
    const arr = state.userWalletLabels?.[userId];
    if (arr && arr.length > newCount) arr.length = Math.max(0, newCount);
}

export function getWalletLabelsForUser(state: BotState, userId: string, walletCount: number): string[] {
    const stored = state.userWalletLabels?.[userId] || [];
    const out: string[] = [];
    for (let i = 0; i < walletCount; i++) {
        out.push(stored[i]?.trim() || '');
    }
    return out;
}

export function applyWalletLabels(state: BotState, userId: string, labels: string[]): void {
    state.userWalletLabels = state.userWalletLabels || {};
    state.userWalletLabels[userId] = labels.map(l => String(l || '').trim().slice(0, MAX_LABEL_LEN));
}
