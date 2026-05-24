/**
 * Per-user compromised (drained / delegation-scam) wallet slots.
 * Compromised wallets stay visible for recovery sweeps but are excluded from minting
 * and must not be used as sweep or distribute destinations.
 */

import type { BotState } from '../bot/stateManager.js';
import {
    getActiveHdIndices,
    getHdWalletCount,
    getStoredImportedCount,
    listManagedWalletSlots,
    type ManagedWalletSlot,
} from './walletDeletion.js';

export type CompromisedWalletEntry = {
    hd: number[];
    imported: number[];
};

function ensureEntry(state: BotState, userId: string): CompromisedWalletEntry {
    if (!state.userCompromisedWallets) state.userCompromisedWallets = {};
    const cur = state.userCompromisedWallets[userId];
    if (!cur) {
        const entry: CompromisedWalletEntry = { hd: [], imported: [] };
        state.userCompromisedWallets[userId] = entry;
        return entry;
    }
    if (!cur.hd) cur.hd = [];
    if (!cur.imported) cur.imported = [];
    return cur as CompromisedWalletEntry;
}

function normalizeEntry(state: BotState, userId: string): CompromisedWalletEntry {
    const entry = ensureEntry(state, userId);
    const hdCount = getHdWalletCount(state, userId);
    const impCount = getStoredImportedCount(state, userId);
    const hdSeen = new Set<number>();
    entry.hd = entry.hd
        .filter(i => Number.isInteger(i) && i >= 0 && i < hdCount && !hdSeen.has(i) && hdSeen.add(i))
        .sort((a, b) => a - b);
    const impSeen = new Set<number>();
    entry.imported = entry.imported
        .filter(
            i =>
                Number.isInteger(i) &&
                i >= 0 &&
                i < impCount &&
                !impSeen.has(i) &&
                impSeen.add(i)
        )
        .sort((a, b) => a - b);
    if (entry.hd.length === 0 && entry.imported.length === 0) {
        delete state.userCompromisedWallets![userId];
        return { hd: [], imported: [] };
    }
    return entry;
}

export function getCompromisedEntry(state: BotState, userId: string): CompromisedWalletEntry {
    const raw = state.userCompromisedWallets?.[userId];
    return {
        hd: [...(raw?.hd ?? [])],
        imported: [...(raw?.imported ?? [])],
    };
}

export function isSlotCompromised(state: BotState, userId: string, slot: ManagedWalletSlot): boolean {
    const entry = state.userCompromisedWallets?.[userId];
    if (!entry) return false;
    if (slot.kind === 'hd') return (entry.hd ?? []).includes(slot.hdIndex);
    return (entry.imported ?? []).includes(slot.impIndex);
}

export function isDisplayIndexCompromised(
    state: BotState,
    userId: string,
    oneBasedDisplay: number
): boolean {
    const slots = listManagedWalletSlots(state, userId);
    const slot = slots[oneBasedDisplay - 1];
    if (!slot) return false;
    return isSlotCompromised(state, userId, slot);
}

export type MarkCompromisedResult =
    | { ok: true; display: number; slot: ManagedWalletSlot }
    | { ok: false; message: string };

export function markWalletCompromised(
    state: BotState,
    userId: string,
    oneBasedDisplay: number
): MarkCompromisedResult {
    const slots = listManagedWalletSlots(state, userId);
    if (slots.length === 0) {
        return { ok: false, message: 'You have no active wallets.' };
    }
    if (oneBasedDisplay < 1 || oneBasedDisplay > slots.length) {
        return {
            ok: false,
            message: `Invalid wallet number. Use 1–${slots.length} (see /wallets).`,
        };
    }
    const slot = slots[oneBasedDisplay - 1]!;
    const entry = ensureEntry(state, userId);
    if (slot.kind === 'hd') {
        if (!entry.hd.includes(slot.hdIndex)) entry.hd.push(slot.hdIndex);
    } else if (!entry.imported.includes(slot.impIndex)) {
        entry.imported.push(slot.impIndex);
    }
    normalizeEntry(state, userId);
    return { ok: true, display: oneBasedDisplay, slot };
}

export function unmarkWalletCompromised(
    state: BotState,
    userId: string,
    oneBasedDisplay: number
): MarkCompromisedResult {
    const slots = listManagedWalletSlots(state, userId);
    if (oneBasedDisplay < 1 || oneBasedDisplay > slots.length) {
        return {
            ok: false,
            message: `Invalid wallet number. Use 1–${slots.length}.`,
        };
    }
    const slot = slots[oneBasedDisplay - 1]!;
    const entry = state.userCompromisedWallets?.[userId];
    if (!entry) {
        return { ok: false, message: `Wallet #${oneBasedDisplay} is not marked compromised.` };
    }
    if (slot.kind === 'hd') {
        entry.hd = (entry.hd ?? []).filter(i => i !== slot.hdIndex);
    } else {
        entry.imported = (entry.imported ?? []).filter(i => i !== slot.impIndex);
    }
    normalizeEntry(state, userId);
    return { ok: true, display: oneBasedDisplay, slot };
}

/** Remove compromised flags for a slot that was deleted. */
export function clearCompromisedSlot(state: BotState, userId: string, slot: ManagedWalletSlot): void {
    const entry = state.userCompromisedWallets?.[userId];
    if (!entry) return;
    if (slot.kind === 'hd') {
        entry.hd = (entry.hd ?? []).filter(i => i !== slot.hdIndex);
    } else {
        entry.imported = (entry.imported ?? []).filter(i => i !== slot.impIndex);
    }
    normalizeEntry(state, userId);
}

export function clearAllCompromisedWallets(state: BotState, userId: string): void {
    if (state.userCompromisedWallets?.[userId]) {
        delete state.userCompromisedWallets[userId];
    }
}

export function listCompromisedDisplayIndices(state: BotState, userId: string): number[] {
    const slots = listManagedWalletSlots(state, userId);
    const out: number[] = [];
    slots.forEach((slot, i) => {
        if (isSlotCompromised(state, userId, slot)) out.push(i + 1);
    });
    return out;
}

export function formatCompromisedSummary(state: BotState, userId: string): string {
    const indices = listCompromisedDisplayIndices(state, userId);
    if (indices.length === 0) {
        return '<i>No wallets marked compromised.</i>';
    }
    return indices.map(n => `<b>#${n}</b>`).join(' · ');
}

export function filterWalletsForMint<T extends { address: string }>(
    state: BotState,
    userId: string,
    wallets: T[]
): T[] {
    const slots = listManagedWalletSlots(state, userId);
    return wallets.filter((_, i) => {
        const slot = slots[i];
        if (!slot) return true;
        return !isSlotCompromised(state, userId, slot);
    });
}

export function getCompromisedAddresses(
    state: BotState,
    userId: string,
    wallets: { address: string }[]
): Set<string> {
    const slots = listManagedWalletSlots(state, userId);
    const out = new Set<string>();
    wallets.forEach((w, i) => {
        const slot = slots[i];
        if (slot && isSlotCompromised(state, userId, slot)) {
            out.add(w.address.toLowerCase());
        }
    });
    return out;
}

export type SweepDestinationCheck =
    | { ok: true }
    | { ok: false; message: string };

/** Block sweeping ETH into a wallet marked compromised (common drain trap). */
export function validateSweepDestination(
    state: BotState,
    userId: string,
    destination: string,
    wallets: { address: string }[]
): SweepDestinationCheck {
    const dest = destination.toLowerCase();
    const compromised = getCompromisedAddresses(state, userId, wallets);
    if (!compromised.has(dest)) return { ok: true };

    const display = wallets.findIndex(w => w.address.toLowerCase() === dest) + 1;
    const label = display > 0 ? `Wallet #${display}` : 'This address';
    return {
        ok: false,
        message:
            `🚫 <b>Sweep blocked</b> — ${label} is marked <b>compromised</b>.\n\n` +
            `Never send fresh ETH to a drained wallet (delegation bots steal deposits).\n` +
            `Use <code>/sweep 0xYourColdWallet</code> or mark safe with <code>/uncompromised ${display > 0 ? display : 'N'}</code>.`,
    };
}

/** Wallets that can receive distribute transfers (excludes compromised). */
export function filterDistributeReceivers(
    state: BotState,
    userId: string,
    addresses: string[],
    allWallets: { address: string }[]
): string[] {
    const compromised = getCompromisedAddresses(state, userId, allWallets);
    return addresses.filter(a => !compromised.has(a.toLowerCase()));
}

export function assertMintWalletAvailable(
    state: BotState,
    userId: string
): { ok: true; count: number } | { ok: false; message: string } {
    const slots = listManagedWalletSlots(state, userId);
    const safe = slots.filter(s => !isSlotCompromised(state, userId, s)).length;
    if (safe === 0) {
        const marked = listCompromisedDisplayIndices(state, userId);
        return {
            ok: false,
            message:
                `⚠️ All ${slots.length} wallet(s) are marked <b>compromised</b> (${marked.map(n => `#${n}`).join(', ')}).\n\n` +
                `Unmark a safe wallet with <code>/uncompromised N</code> or add a new fleet wallet before minting.`,
        };
    }
    return { ok: true, count: safe };
}

export function compromisedEntryForPersistence(
    state: BotState,
    userId: string
): { compromisedHd: number[]; compromisedImported: number[] } {
    const e = getCompromisedEntry(state, userId);
    return { compromisedHd: e.hd, compromisedImported: e.imported };
}
