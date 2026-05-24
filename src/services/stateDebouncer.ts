/**
 * Debounced state writer.
 *
 * Coalesces rapid-fire `StateManager.save(state)` calls into a single write
 * after a configurable quiet period. Prevents disk/Mongo thrashing when many
 * handlers mutate state in quick succession (e.g. during a batch mint).
 *
 * Usage:
 *   import { debouncedSave } from '../services/stateDebouncer';
 *   // Instead of: await StateManager.save(state);
 *   debouncedSave(state);  // non-blocking, coalesced
 *   // For critical saves (shutdown, export): await flushSave(state);
 */

import type { BotState } from '../bot/stateManager';
import { StateManager } from '../bot/stateManager';

let pending: BotState | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_MS = 200;

/**
 * Schedule a save. If another save is requested within DEBOUNCE_MS,
 * the earlier one is replaced (only the latest state snapshot is written).
 */
export function debouncedSave(state: BotState): void {
    pending = state;
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
        timer = null;
        if (pending) {
            const s = pending;
            pending = null;
            try {
                await StateManager.save(s);
            } catch (err) {
                console.error('[StateDebouncer] Save failed:', (err as Error).message);
                // Re-queue so we don't lose the write
                pending = s;
            }
        }
    }, DEBOUNCE_MS);
}

/**
 * Immediately flush any pending save. Use on shutdown or before export commands.
 */
export async function flushSave(state: BotState): Promise<void> {
    if (timer) {
        clearTimeout(timer);
        timer = null;
    }
    pending = null;
    await StateManager.save(state);
}
