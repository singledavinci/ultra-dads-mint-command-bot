/**
 * Durable idempotency for mass DMs and whale alerts (survives deploy / multi-replica).
 */
import { createHash } from 'node:crypto';
import fs from 'fs-extra';
import path from 'node:path';

const LEDGER_FILE = path.join(process.cwd(), 'data', 'notification-ledger.json');
const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const memory = new Map<string, number>();
/** Prevents two concurrent async claimers from both passing before Mongo/file write. */
const claimInFlight = new Set<string>();
let mongoModel: {
    findOne: (q: object) => { lean: () => Promise<{ key?: string } | null> };
    create: (doc: object) => Promise<unknown>;
} | null = null;
let mongoReady = false;

async function getModel() {
    if (mongoReady) return mongoModel;
    mongoReady = true;
    try {
        const { StateManager } = await import('../bot/stateManager.js');
        if (StateManager.isConnected()) {
            const m = await import('mongoose');
            const schema = new m.Schema({
                key: { type: String, required: true, unique: true },
                kind: { type: String, default: 'generic' },
                createdAt: { type: Date, default: Date.now },
            });
            schema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 45 });
            mongoModel =
                (m.default.models.NotificationLedger as typeof mongoModel) ||
                m.default.model('NotificationLedger', schema);
        }
    } catch {
        mongoModel = null;
    }
    return mongoModel;
}

async function loadFileLedger(): Promise<Record<string, number>> {
    try {
        if (await fs.pathExists(LEDGER_FILE)) {
            const raw = await fs.readJson(LEDGER_FILE);
            if (raw && typeof raw === 'object') return raw as Record<string, number>;
        }
    } catch {
        // ignore
    }
    return {};
}

async function persistFile(key: string, at: number): Promise<void> {
    try {
        const all = await loadFileLedger();
        all[key] = at;
        const cutoff = Date.now() - DEFAULT_TTL_MS;
        for (const [k, t] of Object.entries(all)) {
            if (t < cutoff) delete all[k];
        }
        await fs.ensureDir(path.dirname(LEDGER_FILE));
        await fs.writeJson(LEDGER_FILE, all);
    } catch {
        // ignore
    }
}

function ttlForKind(kind: string): number {
    if (kind === 'whale') return 7 * 24 * 60 * 60 * 1000;
    if (kind === 'mass_broadcast') return 90 * 24 * 60 * 60 * 1000;
    if (kind === 'discord_mass_broadcast') return 90 * 24 * 60 * 60 * 1000;
    if (kind === 'link_mint') return 15 * 60 * 1000;
    return DEFAULT_TTL_MS;
}

/**
 * Returns true only for the first caller for this key (process + Mongo + file).
 */
export async function claimNotification(key: string, kind = 'generic'): Promise<boolean> {
    const normalized = key.slice(0, 200);
    const now = Date.now();
    const ttl = ttlForKind(kind);

    const mem = memory.get(normalized);
    if (mem && now - mem < ttl) return false;

    claimInFlight.add(normalized);
    try {
        const file = await loadFileLedger();
        if (file[normalized] && now - file[normalized] < ttl) {
            memory.set(normalized, file[normalized]);
            return false;
        }

        const model = await getModel();
        if (model) {
            try {
                const existing = await model.findOne({ key: normalized }).lean();
                if (existing?.key) {
                    memory.set(normalized, now);
                    return false;
                }
                await model.create({ key: normalized, kind, createdAt: new Date() });
            } catch (err: unknown) {
                if ((err as { code?: number })?.code === 11000) return false;
            }
        }

        memory.set(normalized, now);
        await persistFile(normalized, now);
        return true;
    } finally {
        claimInFlight.delete(normalized);
    }
}

export function hashBroadcastMessage(html: string): string {
    return createHash('sha256').update(html.trim()).digest('hex').slice(0, 32);
}
