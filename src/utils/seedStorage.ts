/**
 * Bot master seed — env-only at runtime; never persist to state.json / Mongo.
 */

import type { BotState } from '../bot/stateManager.js';

/** Live mnemonic for HD derivation (Railway / host env only). */
export function getBotMnemonic(): string | null {
    const m = process.env.MNEMONIC?.trim();
    return m && m.split(/\s+/).length >= 12 ? m : null;
}

/** Remove any legacy mnemonic copied into BotState (compromised-rotation cleanup). */
export function purgeStoredSeed(state: BotState): boolean {
    const had = Boolean(state.mnemonic && state.mnemonic.length > 0);
    delete state.mnemonic;
    return had;
}

/** Strip seed before writing global state to disk or Mongo. */
export function stateForPersistence(state: BotState): BotState {
    const out = { ...state };
    delete out.mnemonic;
    return out;
}

export function formatClearSeedInstructions(adminUserId: string, hdCount = 5): string {
    return (
        `<b>Next steps</b>\n` +
        `1. Sweep salvageable funds — <code>/sweep 0xYourColdWallet</code> (not into ☠️ wallets)\n` +
        `2. Offline: <code>npm run wallets:generate -- --telegram-id ${adminUserId} --count ${hdCount}</code>\n` +
        `3. Railway → set new <code>MNEMONIC</code> · clear <code>IMPORTED_KEYS</code>\n` +
        `4. Redeploy the service\n` +
        `5. <code>/freshadminwallets ${hdCount}</code> → <code>/wallets</code>\n\n` +
        `<i>A new MNEMONIC changes HD addresses for every Telegram user on this bot.</i>`
    );
}
