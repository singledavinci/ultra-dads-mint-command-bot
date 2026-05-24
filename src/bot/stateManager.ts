import fs from 'fs-extra';
import path from 'path';
import { ethers } from 'ethers';
import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import { stateForPersistence } from '../utils/seedStorage.js';
dotenv.config();

export interface ScheduledMint {
    id: string;
    label: string;             // e.g. "Azuki Public Mint"
    contract: string;
    /** Original URL, slug, or address — re-resolved at fire time for GTD/FCFS/SeaDrop */
    sourceInput?: string;
    valueEth: string;          // ETH per tx (0 = auto from resolver at fire time)
    /** When true, non-zero valueEth was user-supplied and may override resolved price at fire. */
    valueEthIsHint?: boolean;
    /** Chain from schedule-time resolve (display / warnings only). */
    chainSlug?: string;
    /** @deprecated Legacy field; fire time uses scheduledDropResolver. */
    data?: string;
    scheduledAt: number;       // unix ms timestamp
    addedBy: string;           // telegram user id
    addedByUsername?: string;
    addedByFirstName?: string;
    fired?: boolean;
    /** Set when boot catch-up grace expired without firing. */
    missed?: boolean;
    /** Gas tier from wizard (normal, fcfs, fcfs_plus, fcfs_max, overdrive). */
    gasTierId?: string;
    /** Extra miner bribe in gwei (scheduled job overrides global). */
    gasBribeGwei?: string;
    /** Priority / builder tip budget in ETH per wallet. */
    priorityBoostEth?: string;
    overdrive?: boolean;
    inclusionMode?: 'public' | 'protected' | 'builder_flashbots' | 'builder_titan';
}

/** Mint fired when chain reaches target block(s) — e.g. per-block cap contracts. */
export interface BlockMintJob {
    id: string;
    label: string;
    contract: string;
    /** URL or contract — re-resolved at each block fire when set */
    sourceInput?: string;
    /** Tx `to` — SeaDrop router when set; defaults to `contract` (NFT). */
    executionTo?: string;
    valueEth: string;
    data: string;
    strategy: 'once' | 'every';
    targetBlock: number;
    blocksRemaining: number;
    addedBy: string;
    addedByUsername?: string;
    addedByFirstName?: string;
    fired?: boolean;
    cancelled?: boolean;
}

export interface BotState {
    trackedAddresses: string[];
    autoMint: boolean;
    skipSimulation?: boolean;
    providerUrl: string;
    /** @deprecated Never persisted — legacy field stripped on load */
    masterKey?: string;
    mintAddress: string;
    mintAmount: string;
    /** @deprecated Never persisted — use MNEMONIC env only; stripped on load/save */
    mnemonic?: string;
    alertChatId?: string;
    userWallets: Record<string, number>; // Maps Telegram ID to HD sub-wallet count (indices 0..n-1)
    /** HD indices removed by user (middle slots); tail deletes shrink userWallets count instead. */
    userHdWalletExcluded?: Record<string, number[]>;
    userWalletLabels?: Record<string, string[]>; // Per-user wallet index → display label
    importedWallets?: Record<string, string[]>; // Maps Telegram ID to array of external raw private keys
    chatMembers?: string[]; // Array of logged User IDs to kick
    trackedCollections?: { address: string, targetFloor: string }[]; // NFT Collections to monitor for profit
    scheduledMints?: ScheduledMint[]; // Drop mints queued to fire at a specific time
    blockMintJobs?: BlockMintJob[]; // Mints queued to fire at specific block(s)
    maxMintLimit?: string; // e.g. "0.05"
    gasBribeGwei?: string; // e.g. "5"
    /** @deprecated Use inclusionMode — true maps to protected on load */
    mevProtection?: boolean;
    /** Transaction inclusion: public | protected | builder_flashbots | builder_titan */
    inclusionMode?: 'public' | 'protected' | 'builder_flashbots' | 'builder_titan';
    accessCode?: string;        // Bot lock passphrase (undefined = open access)
    unlockedUsers?: string[];   // Telegram user IDs that have passed the access code check
    /** Admin /lockuser — blocks until successful /unlock */
    revokedUsers?: string[];
    lastAnnouncedVersion?: string; // Last version string that was broadcast to users
    userRPCs?: { [userId: string]: string }; // Custom RPCs per user
    userTrackedAddresses?: Record<string, string[]>; // Per-user personal tracking list
    userFollowGlobal?: Record<string, boolean>; // Legacy mirror of global alert+automint prefs
    userTrackingPrefs?: Record<
        string,
        {
            alertPersonal?: boolean;
            alertGlobal?: boolean;
            alertCommunity?: boolean;
            autoMintPersonal?: boolean;
            autoMintGlobal?: boolean;
            autoMintCommunity?: boolean;
            copyMintPaymentFilter?: 'free_only' | 'all';
        }
    >;
    overdrive?: boolean; // Toggles aggressive 300% hyper-bidding
    /** Admin runtime overrides for capacity flags (stream #1, fast preflight). */
    capacityOverrides?: {
        streamBroadcast?: boolean;
        skipRpcPreflight?: boolean;
    };
    /** HD / imported indices marked compromised (excluded from mint; blocked as sweep dest). */
    userCompromisedWallets?: Record<
        string,
        {
            hd?: number[];
            imported?: number[];
        }
    >;
    /** Per-user /dropmint wizard button presets. */
    userDropMintPresets?: Record<
        string,
        {
            eth?: string[];
            time?: string[];
            gasTierId?: string;
            gasBribeGwei?: string;
            priorityBoostEth?: string;
        }
    >;
}

const DATA_FILE = path.join(process.cwd(), 'data', 'state.json');
const MONGODB_URI = process.env.MONGODB_URI || process.env.MONGO_URL;

const UserSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
    walletCount: { type: Number, default: 0 },
    hdWalletExcluded: { type: [Number], default: [] },
    compromisedHd: { type: [Number], default: [] },
    compromisedImported: { type: [Number], default: [] },
    walletLabels: { type: [String], default: [] },
    importedWallets: { type: [String], default: [] },
    rpcUrl: { type: String, default: null },
    unlocked: { type: Boolean, default: false },
    trackedAddresses: { type: [String], default: [] },
    followGlobal: { type: Boolean, default: true },
    trackingPrefs: {
        type: {
            alertPersonal: { type: Boolean, default: true },
            alertGlobal: { type: Boolean, default: true },
            alertCommunity: { type: Boolean, default: false },
            autoMintPersonal: { type: Boolean, default: true },
            autoMintGlobal: { type: Boolean, default: true },
            autoMintCommunity: { type: Boolean, default: false },
            copyMintPaymentFilter: { type: String, enum: ['free_only', 'all'], default: 'all' },
        },
        default: undefined,
    },
}, { timestamps: true });

const StateSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    data: { type: Object, default: {} }
});

const StateModel = mongoose.models.BotState || mongoose.model('BotState', StateSchema);
const UserModel = mongoose.models.User || mongoose.model('User', UserSchema);

/** Durable ledger: one row per bot version that already received an auto-announce (survives restarts). */
const VersionAnnounceSchema = new mongoose.Schema({
    version: { type: String, required: true, unique: true },
    announcedAt: { type: Date, default: Date.now },
});
const VersionAnnounceModel =
    mongoose.models.VersionAnnounce || mongoose.model('VersionAnnounce', VersionAnnounceSchema);

/** Survives deploy — prevents replaying whale mints after restart. */
const SeenWhaleTxSchema = new mongoose.Schema({
    txHash: { type: String, required: true, unique: true, lowercase: true },
    seenAt: { type: Date, default: Date.now },
});
SeenWhaleTxSchema.index({ seenAt: 1 }, { expireAfterSeconds: 86400 }); // TTL 24h max retention
const SeenWhaleTxModel =
    mongoose.models.SeenWhaleTx || mongoose.model('SeenWhaleTx', SeenWhaleTxSchema);

const ANNOUNCE_LEDGER_FILE = path.join(process.cwd(), 'data', 'version-announcements.json');

let isMongoConnected = false;

export class StateManager {
    static isConnected(): boolean {
        return isMongoConnected;
    }

    static async connect() {
        if (!MONGODB_URI || isMongoConnected) {
            if (!MONGODB_URI) console.warn('⚠️ MONGODB_URI is not set. Bot will use local state.json (non-persistent).');
            return;
        }

        try {
            // Safe debug log: prints everything except the password
            const masked = MONGODB_URI.replace(/:([^@]+)@/, ':****@');
            console.log(`📡 Attempting MongoDB connection: ${masked}`);

            await mongoose.connect(MONGODB_URI, {
                serverSelectionTimeoutMS: 5000,
            });
            isMongoConnected = true;
            await VersionAnnounceModel.createIndexes();
            await SeenWhaleTxModel.createIndexes();
            console.log('✅ Connected to MongoDB Atlas');
        } catch (err: any) {
            console.error('❌ MongoDB Connection Failed:', err.message);
            if (err.name === 'MongooseServerSelectionError') {
                console.error('👉 TIP: This is usually an IP Whitelist issue. Go to MongoDB Atlas -> Network Access and add "0.0.0.0/0" to allow Render to connect.');
            }
        }
    }

    static async load(): Promise<BotState> {
        await this.connect();

        let stateFromDb: BotState | null = null;
        if (isMongoConnected) {
            try {
                const doc = await StateModel.findOne({ id: 'global_state' });
                if (doc) stateFromDb = doc.data as BotState;
            } catch (err) {
                console.error('Error loading from DB:', err);
            }
        }

        let state: BotState;
        let savedState: BotState | null = null;
        try {
            if (await fs.pathExists(DATA_FILE)) {
                savedState = await fs.readJson(DATA_FILE);
                // Migration: If we have file state but no DB state, push to DB
                if (isMongoConnected && !stateFromDb) {
                    console.log('[Memory] Migrating local state.json to MongoDB Atlas...');
                    if (savedState) await this.save(savedState);
                }
            }
            if (stateFromDb && savedState) {
                state = {
                    ...savedState,
                    ...stateFromDb,
                    lastAnnouncedVersion:
                        stateFromDb.lastAnnouncedVersion ?? savedState.lastAnnouncedVersion,
                };
            } else {
                state = stateFromDb || savedState || this.getDefaultState();
            }
        } catch (error) {
            state = stateFromDb || savedState || this.getDefaultState();
        }

        if (!state.lastAnnouncedVersion) {
            const ledger = await this.loadAnnouncedVersions();
            if (ledger.length > 0) {
                state.lastAnnouncedVersion = ledger[ledger.length - 1];
            }
        }

        const sanitized = this.sanitizeState(state);

        // Merge per-user persistent data
        if (isMongoConnected) {
            const dbUsers = await this.loadAllUsers();
            for (const [uid, uData] of Object.entries(dbUsers)) {
                sanitized.userWallets[uid] = uData.walletCount;
                if (!sanitized.userHdWalletExcluded) sanitized.userHdWalletExcluded = {};
                if (Array.isArray(uData.hdWalletExcluded) && uData.hdWalletExcluded.length) {
                    sanitized.userHdWalletExcluded[uid] = uData.hdWalletExcluded.map(Number);
                }
                if (!sanitized.userCompromisedWallets) sanitized.userCompromisedWallets = {};
                const compHd = (uData as { compromisedHd?: number[] }).compromisedHd;
                const compImp = (uData as { compromisedImported?: number[] }).compromisedImported;
                if (
                    (Array.isArray(compHd) && compHd.length) ||
                    (Array.isArray(compImp) && compImp.length)
                ) {
                    sanitized.userCompromisedWallets[uid] = {
                        hd: Array.isArray(compHd) ? compHd.map(Number) : [],
                        imported: Array.isArray(compImp) ? compImp.map(Number) : [],
                    };
                }
                if (!sanitized.userWalletLabels) sanitized.userWalletLabels = {};
                if (uData.walletLabels?.length) {
                    sanitized.userWalletLabels[uid] = uData.walletLabels;
                }
                if (!sanitized.userRPCs) sanitized.userRPCs = {};
                if (uData.rpcUrl) sanitized.userRPCs[uid] = uData.rpcUrl;
                if (!sanitized.importedWallets) sanitized.importedWallets = {};
                if (uData.importedWallets) sanitized.importedWallets[uid] = uData.importedWallets;
                if (!sanitized.unlockedUsers) sanitized.unlockedUsers = [];
                if (uData.unlocked && !sanitized.unlockedUsers.includes(uid)) {
                    sanitized.unlockedUsers.push(uid);
                }
                if (!sanitized.userTrackedAddresses) sanitized.userTrackedAddresses = {};
                if (uData.trackedAddresses) {
                    sanitized.userTrackedAddresses[uid] = uData.trackedAddresses.map((a: string) =>
                        String(a).toLowerCase()
                    );
                }
                if (!sanitized.userFollowGlobal) sanitized.userFollowGlobal = {};
                sanitized.userFollowGlobal[uid] = uData.followGlobal !== undefined ? uData.followGlobal : true;
                if (!sanitized.userTrackingPrefs) sanitized.userTrackingPrefs = {};
                if (uData.trackingPrefs && typeof uData.trackingPrefs === 'object') {
                    sanitized.userTrackingPrefs[uid] = uData.trackingPrefs;
                }
            }
        }

        return sanitized;
    }

    private static getDefaultState(): BotState {
        return {
            trackedAddresses: [],
            autoMint: false,
            skipSimulation: false,
            providerUrl: process.env.RPC_URL || process.env.PROVIDER_URL || '',
            mintAddress: '',
            mintAmount: '0.01',
            userWallets: {},
            userHdWalletExcluded: {},
            userWalletLabels: {},
            importedWallets: {},
            maxMintLimit: '1.0',
            gasBribeGwei: '0',
            mevProtection: false,
            inclusionMode: 'public',
            accessCode: undefined,
            unlockedUsers: [],
            userRPCs: {},
            userTrackedAddresses: {},
            userFollowGlobal: {},
            userTrackingPrefs: {},
            overdrive: false
        };
    }

    static sanitizeState(savedState: any): BotState {
        delete savedState.masterKey;
        delete savedState.mnemonic;

        // Ensure the maps exist
        if (!savedState.trackedAddresses) savedState.trackedAddresses = [];
        savedState.trackedAddresses = savedState.trackedAddresses.map((a: string) => String(a).toLowerCase());
        if (!savedState.userWallets) savedState.userWallets = {};
        if (!savedState.userHdWalletExcluded) savedState.userHdWalletExcluded = {};
        if (!savedState.userCompromisedWallets) savedState.userCompromisedWallets = {};
        if (!savedState.userWalletLabels) savedState.userWalletLabels = {};
        if (!savedState.importedWallets) savedState.importedWallets = {};
        if (!savedState.chatMembers) savedState.chatMembers = [];
        if (!savedState.trackedCollections) savedState.trackedCollections = [];
        if (!savedState.unlockedUsers) savedState.unlockedUsers = [];
        if (!savedState.revokedUsers) savedState.revokedUsers = [];
        if (typeof savedState.accessCode === 'string') {
            savedState.accessCode = savedState.accessCode.trim() || undefined;
        }
        if (!savedState.userRPCs) savedState.userRPCs = {};
        if (!savedState.userTrackedAddresses) savedState.userTrackedAddresses = {};
        for (const uid of Object.keys(savedState.userTrackedAddresses)) {
            savedState.userTrackedAddresses[uid] = (savedState.userTrackedAddresses[uid] || [])
                .map((a: string) => String(a).toLowerCase())
                .filter((a: string) => a.startsWith('0x'));
        }
        if (!savedState.userFollowGlobal) savedState.userFollowGlobal = {};
        if (!savedState.userTrackingPrefs) savedState.userTrackingPrefs = {};
        if (!savedState.blockMintJobs) savedState.blockMintJobs = [];
        if (savedState.overdrive === undefined) savedState.overdrive = false;

        if (!savedState.inclusionMode && savedState.mevProtection) {
            savedState.inclusionMode = 'protected';
        }
        if (!savedState.inclusionMode) savedState.inclusionMode = 'public';

        // Temporary backward compatibility migration to preserve legacy Master sub-wallets
        const ADMIN_ID = process.env.PERSONAL_ID || '';

        // If they exist as arrays from legacy version, convert to array length counts silently
        for (const key of Object.keys(savedState.userWallets)) {
            if (Array.isArray(savedState.userWallets[key])) {
                savedState.userWallets[key] = (savedState.userWallets[key] as unknown[]).length;
            }
        }

        if (!savedState.userWallets[ADMIN_ID] && savedState.walletCount) {
            savedState.userWallets[ADMIN_ID] = savedState.walletCount || 3;
            console.log(`[Migration] Migrated legacy wallets to HD Derivation for Admin ID ${ADMIN_ID}`);
        }

        return savedState;
    }

    /**
     * Returns true only for the first caller for a given version.
     * File ledger is checked first (survives Mongo blips); Mongo unique index handles
     * multi-replica races. Successful Mongo claims always mirror to the file ledger.
     */
    static async claimVersionAnnounce(version: string): Promise<boolean> {
        if (await this.hasVersionBeenAnnounced(version)) return false;

        if (isMongoConnected) {
            try {
                await VersionAnnounceModel.create({ version });
                await this.persistFileLedgerVersion(version);
                return true;
            } catch (err: any) {
                if (err?.code === 11000) {
                    await this.persistFileLedgerVersion(version);
                    return false;
                }
                console.error('[StateManager] claimVersionAnnounce Mongo error:', err?.message || err);
                try {
                    const doc = await VersionAnnounceModel.findOne({ version }).lean();
                    if (doc) {
                        await this.persistFileLedgerVersion(version);
                        return false;
                    }
                } catch {
                    // ignore — fall through to file claim
                }
            }
        }

        return this.claimFileLedgerVersion(version);
    }

    static async hasVersionBeenAnnounced(version: string): Promise<boolean> {
        const fileLedger = await this.loadFileLedger();
        if (fileLedger.includes(version)) return true;

        if (isMongoConnected) {
            try {
                const doc = await VersionAnnounceModel.findOne({ version }).lean();
                if (doc) {
                    await this.persistFileLedgerVersion(version);
                    return true;
                }
            } catch (err) {
                console.error('[StateManager] hasVersionBeenAnnounced Mongo error:', (err as Error).message);
            }
        }
        return false;
    }

    private static async loadFileLedger(): Promise<string[]> {
        try {
            if (await fs.pathExists(ANNOUNCE_LEDGER_FILE)) {
                const raw = await fs.readJson(ANNOUNCE_LEDGER_FILE);
                return Array.isArray(raw) ? raw.map(String) : [];
            }
        } catch {
            // ignore
        }
        return [];
    }

    /** Idempotent append — keeps file ledger in sync when Mongo already has the version. */
    private static async persistFileLedgerVersion(version: string): Promise<void> {
        try {
            await fs.ensureDir(path.dirname(ANNOUNCE_LEDGER_FILE));
            const versions = await this.loadFileLedger();
            if (versions.includes(version)) return;
            versions.push(version);
            await fs.writeJson(ANNOUNCE_LEDGER_FILE, versions, { spaces: 2 });
        } catch (err) {
            console.error('[StateManager] persistFileLedgerVersion error:', (err as Error).message);
        }
    }

    private static async claimFileLedgerVersion(version: string): Promise<boolean> {
        try {
            await fs.ensureDir(path.dirname(ANNOUNCE_LEDGER_FILE));
            const versions = await this.loadFileLedger();
            if (versions.includes(version)) return false;
            versions.push(version);
            await fs.writeJson(ANNOUNCE_LEDGER_FILE, versions, { spaces: 2 });
            return true;
        } catch (err) {
            console.error('[StateManager] claimFileLedgerVersion error:', (err as Error).message);
            return false;
        }
    }

    /** Load tx hashes seen recently (deploy replay guard). */
    static async loadSeenWhaleTxHashes(maxAgeMs: number): Promise<string[]> {
        if (!isMongoConnected || maxAgeMs <= 0) return [];
        try {
            const since = new Date(Date.now() - maxAgeMs);
            const docs = await SeenWhaleTxModel.find({ seenAt: { $gte: since } })
                .select('txHash')
                .limit(5000)
                .lean();
            return docs.map(d => String(d.txHash).toLowerCase());
        } catch (err) {
            console.warn('[StateManager] loadSeenWhaleTxHashes:', (err as Error).message);
            return [];
        }
    }

    static async persistSeenWhaleTx(txHash: string): Promise<void> {
        if (!isMongoConnected) return;
        const hash = txHash.toLowerCase();
        try {
            await SeenWhaleTxModel.updateOne(
                { txHash: hash },
                { $set: { txHash: hash, seenAt: new Date() } },
                { upsert: true }
            );
        } catch {
            // non-fatal
        }
    }

    private static async loadAnnouncedVersions(): Promise<string[]> {
        const merged = new Set<string>(await this.loadFileLedger());
        if (isMongoConnected) {
            try {
                const docs = await VersionAnnounceModel.find({}).select('version').lean();
                for (const d of docs) merged.add(d.version);
            } catch {
                // file ledger already in merged
            }
        }
        return Array.from(merged);
    }

    static async save(state: BotState): Promise<void> {
        try {
            const persisted = stateForPersistence(state);
            // 1. Local Fallback (Still write to disk if possible)
            await fs.ensureDir(path.dirname(DATA_FILE));
            await fs.writeJson(DATA_FILE, persisted, { spaces: 2 });

            // 2. Remote Persistence
            if (isMongoConnected) {
                await StateModel.findOneAndUpdate(
                    { id: 'global_state' },
                    { data: persisted },
                    { upsert: true }
                );
            }
        } catch (error) {
            console.error('Error saving state:', error);
        }
    }

    /**
     * Specialized per-user persistence to avoid race conditions in multi-user environments.
     */
    static async saveUser(
        userId: string,
        data: {
            walletCount?: number;
            hdWalletExcluded?: number[];
            compromisedHd?: number[];
            compromisedImported?: number[];
            walletLabels?: string[];
            importedWallets?: string[];
            rpcUrl?: string | null;
            unlocked?: boolean;
            trackedAddresses?: string[];
            followGlobal?: boolean;
            trackingPrefs?: Record<string, unknown>;
        }
    ) {
        if (!isMongoConnected) return; // Fallback to global state.json for local/test mode

        try {
            await UserModel.findOneAndUpdate(
                { userId },
                { $set: data },
                { upsert: true }
            );
        } catch (err) {
            console.error(`[StateManager] Failed to save user ${userId}:`, err);
        }
    }

    static async loadAllUsers(): Promise<Record<string, { walletCount: number, hdWalletExcluded: number[], walletLabels: string[], importedWallets: string[], rpcUrl: string | null, unlocked: boolean, trackedAddresses: string[], followGlobal: boolean, trackingPrefs?: Record<string, unknown> }>> {
        const users: Record<string, any> = {};
        if (!isMongoConnected) return users;

        try {
            const docs = await UserModel.find({});
            docs.forEach(d => {
                users[d.userId] = {
                    walletCount: d.walletCount,
                    hdWalletExcluded: d.hdWalletExcluded || [],
                    compromisedHd: d.compromisedHd || [],
                    compromisedImported: d.compromisedImported || [],
                    walletLabels: d.walletLabels || [],
                    importedWallets: d.importedWallets,
                    rpcUrl: d.rpcUrl,
                    unlocked: d.unlocked,
                    trackedAddresses: d.trackedAddresses || [],
                    followGlobal: d.followGlobal !== undefined ? d.followGlobal : true,
                    trackingPrefs: d.trackingPrefs || undefined,
                };
            });
        } catch (err) {
            console.error('[StateManager] Failed to load all users:', err);
        }
        return users;
    }

    static getUnionOfTrackedAddresses(state: BotState): string[] {
        const union = new Set<string>();
        // Add global list
        state.trackedAddresses.forEach(a => union.add(a.toLowerCase()));
        // Add all user lists
        if (state.userTrackedAddresses) {
            for (const list of Object.values(state.userTrackedAddresses)) {
                list.forEach(a => union.add(a.toLowerCase()));
            }
        }
        return Array.from(union);
    }

    /**
     * Remove all tracked whale addresses from global state, in-memory user maps,
     * and every User document in MongoDB (so they do not reappear after restart).
     */
    static async clearAllTrackedAddresses(state: BotState): Promise<{ global: number; personal: number; usersCleared: number }> {
        const globalCount = state.trackedAddresses?.length || 0;
        const personalCount = Object.values(state.userTrackedAddresses || {}).reduce(
            (sum, list) => sum + (list?.length || 0),
            0
        );

        state.trackedAddresses = [];
        if (!state.userTrackedAddresses) state.userTrackedAddresses = {};
        for (const uid of Object.keys(state.userTrackedAddresses)) {
            state.userTrackedAddresses[uid] = [];
        }

        let usersCleared = 0;
        if (isMongoConnected) {
            const result = await UserModel.updateMany({}, { $set: { trackedAddresses: [] } });
            usersCleared = result.modifiedCount + result.matchedCount;
        }

        await StateManager.save(state);
        return { global: globalCount, personal: personalCount, usersCleared };
    }

    /**
     * Clear only per-user personal tracked wallets (keeps global trackedAddresses).
     */
    static async clearAllUserTrackedAddresses(state: BotState): Promise<{ personal: number; usersCleared: number }> {
        const personalCount = Object.values(state.userTrackedAddresses || {}).reduce(
            (sum, list) => sum + (list?.length || 0),
            0
        );

        if (!state.userTrackedAddresses) state.userTrackedAddresses = {};
        for (const uid of Object.keys(state.userTrackedAddresses)) {
            state.userTrackedAddresses[uid] = [];
        }

        let usersCleared = 0;
        if (isMongoConnected) {
            const result = await UserModel.updateMany({}, { $set: { trackedAddresses: [] } });
            usersCleared = result.modifiedCount + result.matchedCount;
        }

        await StateManager.save(state);
        return { personal: personalCount, usersCleared };
    }
}
