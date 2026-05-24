/**
 * Runtime role for split Telegram bot deployments.
 * Maps to Discord-style "two applications" — each Railway service sets BOT_ROLE.
 */

export type BotRole = 'copy' | 'mint' | 'all';

export function resolveBotRole(): BotRole {
    const explicit = (process.env.BOT_ROLE || '').trim().toLowerCase();
    if (explicit === 'copy' || explicit === 'mint' || explicit === 'all') {
        return explicit;
    }

    const copyEnabled = process.env.COPY_BOT_ENABLED !== 'false';
    const mintEnabled = process.env.MINT_BOT_ENABLED !== 'false';

    if (copyEnabled && !mintEnabled) return 'copy';
    if (mintEnabled && !copyEnabled) return 'mint';

    if (process.env.COPY_BOT_TOKEN && !process.env.MINT_BOT_TOKEN && !process.env.BOT_TOKEN) {
        return 'copy';
    }
    if (process.env.MINT_BOT_TOKEN && !process.env.COPY_BOT_TOKEN && !process.env.BOT_TOKEN) {
        return 'mint';
    }

    return 'all';
}

export function getServiceName(role: BotRole): string {
    if (role === 'copy') return 'copy-mint-bot';
    if (role === 'mint') return 'mint-command-bot';
    return 'ultra-dads-minter-monolith';
}

export function runsCopyMintServices(role: BotRole): boolean {
    return role === 'copy' || role === 'all';
}

export function runsMintCommandServices(role: BotRole): boolean {
    return role === 'mint' || role === 'all';
}

export function isRoleEnabled(role: BotRole): boolean {
    if (role === 'copy') return process.env.COPY_BOT_ENABLED !== 'false';
    if (role === 'mint') return process.env.MINT_BOT_ENABLED !== 'false';
    return true;
}
