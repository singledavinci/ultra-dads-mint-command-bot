/**
 * Admin runtime overrides for capacity flags (persisted in BotState).
 * Env defaults from getRuntimeConfig(); overrides apply until cleared or changed.
 */
import { getRuntimeConfig } from './runtimeConfig';
import type { BotState } from '../bot/stateManager';

export type CapacityOverrideKey = 'streamBroadcast' | 'skipRpcPreflight';

export type CapacityOverrides = Partial<Record<CapacityOverrideKey, boolean>>;

let overrides: CapacityOverrides = {};

export function syncCapacityOverridesFromState(state: Pick<BotState, 'capacityOverrides'>): void {
    overrides = { ...(state.capacityOverrides || {}) };
}

export function getCapacityOverrides(): Readonly<CapacityOverrides> {
    return overrides;
}

export function effectiveStreamBroadcast(): boolean {
    const cfg = getRuntimeConfig();
    return overrides.streamBroadcast ?? cfg.streamBroadcast;
}

export function effectiveSkipRpcPreflight(): boolean {
    const cfg = getRuntimeConfig();
    return overrides.skipRpcPreflight ?? cfg.skipRpcPreflight;
}

export function isCapacityOverride(key: CapacityOverrideKey): boolean {
    return overrides[key] !== undefined;
}

export function toggleCapacityOverride(key: CapacityOverrideKey): boolean {
    const cfg = getRuntimeConfig();
    const current =
        key === 'streamBroadcast'
            ? effectiveStreamBroadcast()
            : effectiveSkipRpcPreflight();
    overrides[key] = !current;
    return overrides[key]!;
}

export function clearCapacityOverride(key: CapacityOverrideKey): void {
    delete overrides[key];
}

export function capacityOverridesForState(): CapacityOverrides {
    const out: CapacityOverrides = {};
    if (overrides.streamBroadcast !== undefined) out.streamBroadcast = overrides.streamBroadcast;
    if (overrides.skipRpcPreflight !== undefined) out.skipRpcPreflight = overrides.skipRpcPreflight;
    return out;
}
