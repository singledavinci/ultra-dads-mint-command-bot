import type { BotRole } from './role.js';
import { getServiceName } from './role.js';

export interface HealthSnapshot {
    ok: boolean;
    service: string;
    version: string;
    uptime: number;
    discord: 'ready' | 'not_ready';
    walletTracker: 'running' | 'stopped';
    rpc: 'connected' | 'degraded' | 'missing';
    commands: 'loaded' | 'filtered';
    role: BotRole;
    tracker?: boolean;
    mongo?: string;
    telegramMode?: string;
}

export function buildHealthJson(snapshot: HealthSnapshot): Record<string, unknown> {
    if (snapshot.service === 'copy-mint-bot') {
        return {
            ok: snapshot.ok,
            service: snapshot.service,
            discord: snapshot.discord,
            walletTracker: snapshot.walletTracker,
            rpc: snapshot.rpc,
            uptime: snapshot.uptime,
            version: snapshot.version,
            role: snapshot.role,
            tracker: snapshot.tracker,
            mongo: snapshot.mongo,
            telegramMode: snapshot.telegramMode,
        };
    }

    if (snapshot.service === 'mint-command-bot') {
        return {
            ok: snapshot.ok,
            service: snapshot.service,
            discord: snapshot.discord,
            commands: snapshot.commands,
            rpc: snapshot.rpc,
            uptime: snapshot.uptime,
            version: snapshot.version,
            role: snapshot.role,
            mongo: snapshot.mongo,
            telegramMode: snapshot.telegramMode,
        };
    }

    return { ...snapshot };
}

export function healthPathForRole(role: BotRole): string {
    if (role === 'copy') return '/health/copy-mint';
    if (role === 'mint') return '/health/mint-command';
    return '/health';
}

export function serviceLabel(role: BotRole): string {
    return getServiceName(role);
}
