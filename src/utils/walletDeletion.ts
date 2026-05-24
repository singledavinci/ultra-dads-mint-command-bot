import type { BotState } from '../bot/stateManager';
import { clearCompromisedSlot } from './compromisedWallets.js';
import { trimWalletLabels } from './walletLabels';

export type RemoveWalletResult =
    | {
          ok: true;
          removedDisplay: number;
          kind: 'hd' | 'imported';
          hdCount: number;
          importedCount: number;
          activeHdCount: number;
          activeTotal: number;
      }
    | { ok: false; message: string };

export type ManagedWalletSlot =
    | { kind: 'hd'; hdIndex: number }
    | { kind: 'imported'; impIndex: number };

/** Stored HD sub-wallet count (indices 0 .. count-1). */
export function getHdWalletCount(state: BotState, userId: string): number {
    const raw = state.userWallets[userId];
    if (typeof raw === 'number') return Math.max(0, raw);
    if (Array.isArray(raw)) return (raw as unknown[]).length;
    return 0;
}

export function getStoredImportedCount(state: BotState, userId: string): number {
    return state.importedWallets?.[userId]?.length ?? 0;
}

function ensureExcludedMap(state: BotState): Record<string, number[]> {
    if (!state.userHdWalletExcluded) state.userHdWalletExcluded = {};
    return state.userHdWalletExcluded;
}

/** HD derivation indices the user has removed (middle slots stay excluded; tail shrinks count). */
export function getHdExcludedIndices(state: BotState, userId: string): number[] {
    const hdCount = getHdWalletCount(state, userId);
    const raw = ensureExcludedMap(state)[userId] ?? [];
    const seen = new Set<number>();
    const out: number[] = [];
    for (const n of raw) {
        const i = Number(n);
        if (!Number.isInteger(i) || i < 0 || i >= hdCount || seen.has(i)) continue;
        seen.add(i);
        out.push(i);
    }
    out.sort((a, b) => a - b);
    ensureExcludedMap(state)[userId] = out;
    return out;
}

export function getHdExcludedSet(state: BotState, userId: string): Set<number> {
    return new Set(getHdExcludedIndices(state, userId));
}

export function getActiveHdIndices(state: BotState, userId: string): number[] {
    const hdCount = getHdWalletCount(state, userId);
    const excluded = getHdExcludedSet(state, userId);
    const out: number[] = [];
    for (let i = 0; i < hdCount; i++) {
        if (!excluded.has(i)) out.push(i);
    }
    return out;
}

/** Active managed wallets in display order (HD slots then imported). */
export function listManagedWalletSlots(state: BotState, userId: string): ManagedWalletSlot[] {
    const slots: ManagedWalletSlot[] = [];
    for (const hdIndex of getActiveHdIndices(state, userId)) {
        slots.push({ kind: 'hd', hdIndex });
    }
    const importedLen = getStoredImportedCount(state, userId);
    for (let impIndex = 0; impIndex < importedLen; impIndex++) {
        slots.push({ kind: 'imported', impIndex });
    }
    return slots;
}

export function getActiveManagedWalletCount(state: BotState, userId: string): number {
    return listManagedWalletSlots(state, userId).length;
}

/** @deprecated Use getActiveManagedWalletCount — kept for callers expecting old name. */
export function getManagedWalletCount(state: BotState, userId: string): number {
    return getActiveManagedWalletCount(state, userId);
}

function pruneExcludedAboveCount(state: BotState, userId: string, hdCount: number): void {
    const map = ensureExcludedMap(state);
    const pruned = (map[userId] ?? []).filter(i => i >= 0 && i < hdCount);
    if (pruned.length === 0) delete map[userId];
    else map[userId] = pruned;
}

function excludeHdIndex(state: BotState, userId: string, hdIndex: number): void {
    const map = ensureExcludedMap(state);
    const set = new Set(map[userId] ?? []);
    set.add(hdIndex);
    map[userId] = Array.from(set).sort((a, b) => a - b);
}

export function removeUserWallet(
    state: BotState,
    userId: string,
    oneBasedIndex?: number
): RemoveWalletResult {
    if (!state.importedWallets) state.importedWallets = {};
    const imported = state.importedWallets[userId] ?? [];
    const slots = listManagedWalletSlots(state, userId);
    const hdCount = getHdWalletCount(state, userId);

    if (slots.length === 0) {
        return { ok: false, message: 'You have no active wallets to delete.' };
    }

    const displayIndex =
        oneBasedIndex === undefined || Number.isNaN(oneBasedIndex) ? slots.length : oneBasedIndex;

    if (displayIndex < 1 || displayIndex > slots.length) {
        return {
            ok: false,
            message: `Invalid wallet number. You have ${slots.length} active wallet(s) (use 1-${slots.length}).`,
        };
    }

    const slot = slots[displayIndex - 1];

    clearCompromisedSlot(state, userId, slot);

    if (slot.kind === 'imported') {
        imported.splice(slot.impIndex, 1);
        if (imported.length === 0) {
            delete state.importedWallets[userId];
        } else {
            state.importedWallets[userId] = imported;
        }
        const activeTotal = listManagedWalletSlots(state, userId).length;
        return {
            ok: true,
            removedDisplay: displayIndex,
            kind: 'imported',
            hdCount,
            importedCount: imported.length,
            activeHdCount: getActiveHdIndices(state, userId).length,
            activeTotal,
        };
    }

    const activeHd = getActiveHdIndices(state, userId);
    if (activeHd.length <= 1 && imported.length === 0) {
        return { ok: false, message: 'You must keep at least one active sub-wallet.' };
    }

    const { hdIndex } = slot;

    // Removing the highest HD index: shrink stored count (true tail delete).
    if (hdIndex === hdCount - 1) {
        const newHdCount = hdCount - 1;
        state.userWallets[userId] = newHdCount;
        trimWalletLabels(state, userId, newHdCount);
        pruneExcludedAboveCount(state, userId, newHdCount);
    } else {
        excludeHdIndex(state, userId, hdIndex);
    }

    const newHdCount = getHdWalletCount(state, userId);
    const activeTotal = listManagedWalletSlots(state, userId).length;
    return {
        ok: true,
        removedDisplay: displayIndex,
        kind: 'hd',
        hdCount: newHdCount,
        importedCount: imported.length,
        activeHdCount: getActiveHdIndices(state, userId).length,
        activeTotal,
    };
}
