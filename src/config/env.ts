/**
 * Centralized environment validation and exposure.
 *
 * Imported once at boot from src/bot/index.ts. Throws synchronously if any
 * required variable is missing or syntactically invalid, and prints a redacted
 * summary so the bot's startup log proves which secrets are present without
 * leaking their values.
 *
 * No other module should call `process.env.*` for the variables exposed here —
 * import the typed constants from this module instead. Optional, performance-
 * tuning knobs live below the required block.
 */

import * as dotenv from 'dotenv';
dotenv.config();

export interface BotEnv {
    BOT_TOKEN: string;
    PERSONAL_ID: string;
    GROUP_ID: string;
    MNEMONIC: string;
    PROVIDER_URL: string;
    PROVIDER_URLS: string[]; // PROVIDER_URL split by ','
    IMPORTED_KEYS: string[]; // never empty if env had a value, never undefined
    MONGODB_URI?: string;
    API_SECRET?: string;
    PORT: number;
    NODE_ENV: 'production' | 'development' | 'test';

    // Tuning
    EXECUTION_CONCURRENCY: number;
    RPC_TIMEOUT_MS: number;
    RPC_FAILOVER_ENABLED: boolean;
    SIMULATION_CACHE_TTL_MS: number;
    TX_CONFIRMATION_BLOCKS: number;
    AUTO_EXECUTE_BEFORE_METADATA: boolean;
    NONCE_CACHE_TTL_MS: number;

    // Detection (Phase 7)
    WS_RPC_URL?: string;
    BACKUP_WS_RPC_URLS: string[];
    ENABLE_PENDING_DETECTION: boolean;
    ENABLE_BLOCK_FALLBACK: boolean;
    DEDUPE_TTL_MS: number;
    TX_WAIT_TIMEOUT_MS: number;
    COPY_UNKNOWN_MINT_CALLS: boolean;
    RESERVOIR_API_KEY?: string;
}

const REQUIRED_KEYS = ['BOT_TOKEN', 'PERSONAL_ID', 'GROUP_ID', 'MNEMONIC', 'PROVIDER_URL'] as const;

/** Patterns of dangerous default values that must never reach production. */
const DANGEROUS_DEFAULTS: Array<{ key: keyof BotEnv | 'IMPORTED_KEYS_RAW'; pattern: RegExp; reason: string }> = [
    { key: 'BOT_TOKEN', pattern: /AAFuxHV7nJvhyKpBexiDMFN/, reason: 'leaked legacy bot token from repo history (render.yaml)' },
    { key: 'BOT_TOKEN', pattern: /AAFuxHV7nJvhyKpBexiDMFN_9sczDay5UIQ/, reason: 'leaked legacy bot token from test-telegram.mjs' },
    { key: 'PROVIDER_URL', pattern: /sleek-misty-sea\.quiknode\.pro/, reason: 'leaked QuickNode key from repo history' },
    { key: 'PROVIDER_URL', pattern: /CF_OtxYSedKG9gVBZViZmUAzZvx_lBiU/, reason: 'leaked Alchemy key from repo history' },
];

function readBool(name: string, fallback: boolean): boolean {
    const v = process.env[name];
    if (v === undefined || v === '') return fallback;
    return /^(1|true|yes|on)$/i.test(v.trim());
}

function readInt(name: string, fallback: number, min = 0): number {
    const v = process.env[name];
    if (!v) return fallback;
    const n = parseInt(v, 10);
    if (Number.isNaN(n) || n < min) {
        console.warn(`[env] ${name}=${v} is not a valid integer >= ${min}; using ${fallback}`);
        return fallback;
    }
    return n;
}

function maskRpc(url: string): string {
    try {
        const u = new URL(url);
        return `${u.protocol}//${u.hostname}${u.pathname.length > 1 ? '/***' : ''}`;
    } catch {
        return '<invalid-url>';
    }
}

function maskToken(t: string): string {
    if (!t) return '<empty>';
    if (t.length < 12) return '<too-short>';
    return `${t.slice(0, 6)}…${t.slice(-4)}`;
}

let cached: BotEnv | null = null;

export function loadEnv(): BotEnv {
    if (cached) return cached;

    const missing: string[] = [];
    for (const key of REQUIRED_KEYS) {
        const v = process.env[key];
        if (!v || !v.trim()) missing.push(key);
    }

    const NODE_ENV = (process.env.NODE_ENV ?? 'production') as BotEnv['NODE_ENV'];
    const apiSecret = (process.env.API_SECRET ?? '').trim();
    if (NODE_ENV === 'production' && !apiSecret) {
        missing.push('API_SECRET (required in production)');
    }

    if (missing.length) {
        console.error('[env] Missing required environment variables:');
        for (const m of missing) console.error(`  - ${m}`);
        console.error('[env] See .env.example for the full reference.');
        process.exit(1);
    }

    const BOT_TOKEN = process.env.BOT_TOKEN!.trim();
    const PERSONAL_ID = process.env.PERSONAL_ID!.trim();
    const GROUP_ID = process.env.GROUP_ID!.trim();
    const MNEMONIC = process.env.MNEMONIC!.trim();
    const PROVIDER_URL_RAW = process.env.PROVIDER_URL!.trim();
    const PROVIDER_URLS = PROVIDER_URL_RAW.split(',').map(s => s.trim()).filter(Boolean);
    const IMPORTED_KEYS = (process.env.IMPORTED_KEYS ?? '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
        .map(k => (k.startsWith('0x') ? k : `0x${k}`));

    if (!BOT_TOKEN.includes(':')) {
        console.error('[env] BOT_TOKEN does not look like a Telegram bot token.');
        process.exit(1);
    }
    if (!/^-?\d{4,}$/.test(PERSONAL_ID)) {
        console.error('[env] PERSONAL_ID must be a numeric Telegram user id.');
        process.exit(1);
    }
    if (!/^-?\d{4,}$/.test(GROUP_ID)) {
        console.error('[env] GROUP_ID must be a numeric Telegram chat id.');
        process.exit(1);
    }
    if (MNEMONIC.split(/\s+/).length < 12) {
        console.error('[env] MNEMONIC must be a 12 or 24 word seed phrase.');
        process.exit(1);
    }
    if (PROVIDER_URLS.length === 0) {
        console.error('[env] PROVIDER_URL must contain at least one URL.');
        process.exit(1);
    }
    for (const k of IMPORTED_KEYS) {
        if (!/^0x[0-9a-fA-F]{64}$/.test(k)) {
            console.error('[env] IMPORTED_KEYS contains a value that is not a 0x-prefixed 64-hex private key.');
            process.exit(1);
        }
    }

    const skipProviderLeakBlock = /^(1|true|yes|on)$/i.test(
        (process.env.SKIP_DANGEROUS_PROVIDER_URL_PATTERN ?? '').trim()
    );

    // Reject leaked defaults explicitly.
    const merged: Record<string, string | string[]> = {
        BOT_TOKEN, PERSONAL_ID, GROUP_ID, MNEMONIC,
        PROVIDER_URL: PROVIDER_URL_RAW,
    };
    for (const rule of DANGEROUS_DEFAULTS) {
        const v = merged[rule.key as string];
        if (typeof v === 'string' && rule.pattern.test(v)) {
            if (rule.key === 'PROVIDER_URL' && skipProviderLeakBlock) {
                console.warn(
                    '[env] SKIP_DANGEROUS_PROVIDER_URL_PATTERN=true — allowing PROVIDER_URL that matched a historical leak pattern. ' +
                        'Use only with a newly issued endpoint; compromised URLs must be rotated.'
                );
                continue;
            }
            console.error(`[env] ${rule.key} matches a known leaked default: ${rule.reason}.`);
            console.error(
                '[env] The process exits here, so Railway (and any /health check) will fail until you update this value.'
            );
            console.error('[env] Generate a new RPC URL (QuickNode / Alchemy / etc.) and set PROVIDER_URL in Railway Variables.');
            if (rule.key === 'PROVIDER_URL') {
                console.error(
                    '[env] Emergency override (risky): SKIP_DANGEROUS_PROVIDER_URL_PATTERN=true if you are certain the credential is new.'
                );
            } else {
                console.error('[env] Rotate the credential and update the environment before starting.');
            }
            process.exit(1);
        }
    }

    cached = {
        BOT_TOKEN,
        PERSONAL_ID,
        GROUP_ID,
        MNEMONIC,
        PROVIDER_URL: PROVIDER_URL_RAW,
        PROVIDER_URLS,
        IMPORTED_KEYS,
        MONGODB_URI: process.env.MONGODB_URI?.trim() || process.env.MONGO_URL?.trim() || undefined,
        API_SECRET: apiSecret || undefined,
        PORT: readInt('PORT', 3000, 1),
        NODE_ENV,
        EXECUTION_CONCURRENCY: readInt('EXECUTION_CONCURRENCY', 4, 1),
        RPC_TIMEOUT_MS: readInt('RPC_TIMEOUT_MS', 8000, 100),
        RPC_FAILOVER_ENABLED: readBool('RPC_FAILOVER_ENABLED', true),
        SIMULATION_CACHE_TTL_MS: readInt('SIMULATION_CACHE_TTL_MS', 300_000, 0),
        TX_CONFIRMATION_BLOCKS: readInt('TX_CONFIRMATION_BLOCKS', 1, 0),
        AUTO_EXECUTE_BEFORE_METADATA: readBool('AUTO_EXECUTE_BEFORE_METADATA', true),
        NONCE_CACHE_TTL_MS: readInt('NONCE_CACHE_TTL_MS', 60_000, 0),

        // Detection (Phase 7)
        WS_RPC_URL: process.env.WS_RPC_URL?.trim() || undefined,
        BACKUP_WS_RPC_URLS: (process.env.BACKUP_WS_RPC_URLS ?? '').split(',').map(s => s.trim()).filter(Boolean),
        ENABLE_PENDING_DETECTION: readBool('ENABLE_PENDING_DETECTION', true),
        ENABLE_BLOCK_FALLBACK: readBool('ENABLE_BLOCK_FALLBACK', true),
        DEDUPE_TTL_MS: readInt('DEDUPE_TTL_MS', 300_000, 0),
        TX_WAIT_TIMEOUT_MS: readInt('TX_WAIT_TIMEOUT_MS', 60_000, 5000),
        COPY_UNKNOWN_MINT_CALLS: readBool('COPY_UNKNOWN_MINT_CALLS', false),
        RESERVOIR_API_KEY: process.env.RESERVOIR_API_KEY?.trim() || undefined,
    };

    printRedactedSummary(cached);
    return cached;
}

function printRedactedSummary(env: BotEnv) {
    console.log('[env] Validated environment:');
    console.log(`  NODE_ENV=${env.NODE_ENV}`);
    console.log(`  BOT_TOKEN=${maskToken(env.BOT_TOKEN)}`);
    console.log(`  PERSONAL_ID=${env.PERSONAL_ID.slice(0, 3)}***`);
    console.log(`  GROUP_ID=${env.GROUP_ID}`);
    console.log(`  MNEMONIC=<${env.MNEMONIC.split(/\s+/).length} words present>`);
    console.log(`  IMPORTED_KEYS=<${env.IMPORTED_KEYS.length} key(s) loaded>`);
    console.log(`  PROVIDER_URLS=${env.PROVIDER_URLS.map(maskRpc).join(', ')}`);
    console.log(`  MONGODB_URI=${env.MONGODB_URI ? '<set>' : '<unset, file-only>'}`);
    console.log(`  API_SECRET=${env.API_SECRET ? '<set>' : '<unset>'}`);
    console.log(`  PORT=${env.PORT}`);
    console.log(`  EXECUTION_CONCURRENCY=${env.EXECUTION_CONCURRENCY} RPC_TIMEOUT_MS=${env.RPC_TIMEOUT_MS} FAILOVER=${env.RPC_FAILOVER_ENABLED}`);
}
