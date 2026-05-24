/**
 * Drop mint wizard presets — env defaults + per-user saved buttons.
 */

import type { BotState } from '../bot/stateManager.js';
import { parseDropMintTimeArg } from './dropMintScheduleUtils.js';

export type DropMintPresetButton = { label: string; value: string };

const DEFAULT_ETH = ['0', '0.05', '0.08', '0.1'];
const DEFAULT_TIME = ['now', '+5m', '+10m', '+30m', '+1h'];

const MAX_USER_ETH = 6;
const MAX_USER_TIME = 6;
const MAX_BUTTONS = 8;

function parseCsv(raw: string | undefined): string[] {
    if (!raw?.trim()) return [];
    return raw
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
}

function uniquePreserveOrder(items: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of items) {
        const key = item.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(item);
    }
    return out;
}

export function parseCustomEthInput(text: string): { ok: true; value: string } | { ok: false; error: string } {
    const t = text.trim().replace(/eth$/i, '').trim();
    const n = parseFloat(t);
    if (Number.isNaN(n) || n < 0) {
        return { ok: false, error: 'Send a non-negative number (e.g. 0.08 or 0 for auto).' };
    }
    return { ok: true, value: String(n) };
}

export function parseCustomTimeInput(text: string): { ok: true; arg: string } | { ok: false; error: string } {
    const trimmed = text.trim();
    const parsed = parseDropMintTimeArg(trimmed);
    if (typeof parsed === 'number') {
        return { ok: true, arg: trimmed };
    }
    return { ok: false, error: parsed.error };
}

function ethLabel(value: string): string {
    return parseFloat(value) > 0 ? `${value}` : 'Auto';
}

function timeLabel(arg: string): string {
    if (arg === 'now') return 'Now';
    if (arg.startsWith('+')) return arg.replace('+', '+');
    return arg;
}

export function getEthPresetButtons(state: BotState, userId: string): DropMintPresetButton[] {
    const env = parseCsv(process.env.DROP_MINT_ETH_PRESETS);
    const user = state.userDropMintPresets?.[userId]?.eth ?? [];
    const merged = uniquePreserveOrder([...user, ...(env.length ? env : DEFAULT_ETH)]);
    return merged.slice(0, MAX_BUTTONS).map(value => ({
        label: user.includes(value) ? `⭐ ${ethLabel(value)}` : ethLabel(value),
        value,
    }));
}

export function getTimePresetButtons(state: BotState, userId: string): DropMintPresetButton[] {
    const env = parseCsv(process.env.DROP_MINT_TIME_PRESETS);
    const user = state.userDropMintPresets?.[userId]?.time ?? [];
    const merged = uniquePreserveOrder([...user, ...(env.length ? env : DEFAULT_TIME)]);
    return merged.slice(0, MAX_BUTTONS).map(arg => ({
        label: user.includes(arg) ? `⭐ ${timeLabel(arg)}` : timeLabel(arg),
        value: arg,
    }));
}

export function saveUserEthPreset(state: BotState, userId: string, valueEth: string): void {
    if (!state.userDropMintPresets) state.userDropMintPresets = {};
    const entry = state.userDropMintPresets[userId] ?? {};
    const list = uniquePreserveOrder([valueEth, ...(entry.eth ?? [])]).slice(0, MAX_USER_ETH);
    state.userDropMintPresets[userId] = { ...entry, eth: list };
}

export function saveUserTimePreset(state: BotState, userId: string, timeArg: string): void {
    if (!state.userDropMintPresets) state.userDropMintPresets = {};
    const entry = state.userDropMintPresets[userId] ?? {};
    const list = uniquePreserveOrder([timeArg, ...(entry.time ?? [])]).slice(0, MAX_USER_TIME);
    state.userDropMintPresets[userId] = { ...entry, time: list };
}

export function clearUserDropMintPresets(state: BotState, userId: string): void {
    if (!state.userDropMintPresets?.[userId]) return;
    delete state.userDropMintPresets[userId];
}

export function getSavedGasPreset(state: BotState, userId: string): {
    gasTierId?: string;
    gasBribeGwei?: string;
    priorityBoostEth?: string;
} | null {
    const p = state.userDropMintPresets?.[userId];
    if (!p?.gasTierId && !p?.gasBribeGwei && !p?.priorityBoostEth) return null;
    return {
        gasTierId: p.gasTierId,
        gasBribeGwei: p.gasBribeGwei,
        priorityBoostEth: p.priorityBoostEth,
    };
}

export function saveUserGasPreset(
    state: BotState,
    userId: string,
    gas: { gasTierId?: string; gasBribeGwei?: string; priorityBoostEth?: string }
): void {
    if (!state.userDropMintPresets) state.userDropMintPresets = {};
    const entry = state.userDropMintPresets[userId] ?? {};
    state.userDropMintPresets[userId] = {
        ...entry,
        gasTierId: gas.gasTierId ?? entry.gasTierId,
        gasBribeGwei: gas.gasBribeGwei ?? entry.gasBribeGwei,
        priorityBoostEth: gas.priorityBoostEth ?? entry.priorityBoostEth,
    };
}

export function formatUserPresetsSummary(state: BotState, userId: string): string {
    const p = state.userDropMintPresets?.[userId];
    if (!p?.eth?.length && !p?.time?.length && !p?.gasTierId && !p?.gasBribeGwei && !p?.priorityBoostEth) {
        return '<i>No saved presets yet. Use Custom, then 💾 Save preset.</i>';
    }
    const eth = (p.eth ?? []).map(e => `<code>${e}</code>`).join(' · ') || '—';
    const time = (p.time ?? []).map(t => `<code>${t}</code>`).join(' · ') || '—';
    const gas = p.gasTierId
        ? `<code>${p.gasTierId}</code>${p.gasBribeGwei ? ` +${p.gasBribeGwei}gwei` : ''}${p.priorityBoostEth ? ` tip ${p.priorityBoostEth}` : ''}`
        : '—';
    return `⭐ <b>Your presets</b>\nPrice: ${eth}\nTime: ${time}\nGas: ${gas}`;
}
