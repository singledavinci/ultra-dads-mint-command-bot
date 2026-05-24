/**
 * Telegram HTML formatting helpers shared by alerts and admin notifications.
 */

export interface TelegramUserRef {
    userId: string;
    username?: string;
    firstName?: string;
    lastName?: string;
}

export function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Display label for admin pings: @handle, name, or numeric id. */
export function formatTelegramUserLabel(ref: TelegramUserRef): string {
    const { userId, username, firstName, lastName } = ref;
    if (username) return `@${escapeHtml(username)}`;
    const name = [firstName, lastName].filter(Boolean).join(' ').trim();
    if (name) return `${escapeHtml(name)} (<code>${userId}</code>)`;
    return `<code>${userId}</code>`;
}

export function formatSupplyLine(minted?: string, max?: string): string {
    if (minted && max) return `${minted} / ${max}`;
    if (minted) return `${minted} minted`;
    if (max) return `max ${max}`;
    return 'Unknown';
}
