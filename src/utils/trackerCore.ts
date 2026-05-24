/**
 * MintTracker v2 — WebSocket primary + HTTP fallback + pending tx detection.
 *
 * Detection paths:
 *   1. PENDING (fastest): WebSocket subscribes to pending txs, filters by tracked
 *      wallets, classifies as mint, fires callback immediately.
 *   2. CONFIRMED (fallback): HTTP polling or WS block events, fetches full block,
 *      verifies mint via receipt logs. Acts as reconciliation for missed pending txs.
 *
 * Both paths feed through the same deduplicator so a tx detected as pending
 * won't re-trigger when confirmed.
 */

import { JsonRpcProvider, WebSocketProvider, Wallet } from 'ethers';
import type { TransactionResponse } from 'ethers';
import { classifyMintTransaction, classifyTrackedWalletTx } from '../services/mintClassifier';
import { markTxSeenIfNew } from '../services/deduplicator';
import { isRateLimitedRpcError } from '../services/rpcLimiter';
import { getRuntimeConfig } from '../config/runtimeConfig';
import type { TrackerStats } from '../types/detection';
import type { MintCandidate } from '../types/mintIntent';
import { normalizeTrackedWallet } from '../services/trackedWalletRegistry';
import { trackerDebugState } from '../services/trackerDebugState';
import { log, logRateLimited } from './logger';

export interface TrackedWallet {
    address: string;
    label: string;
    active: boolean;
}

// Keep the legacy interface for backward compatibility with index.ts
export interface DetectedMint {
    hash: string;
    from: string;
    to: string;
    value: string;
    data: string;
    timestamp: number;
    /** Classifier output — used to gate auto-mint on mempool vs confirmed. */
    classificationConfidence: 'high' | 'medium' | 'low';
    /** Where this event was observed. */
    detectionPath: 'pending' | 'confirmed';
    /** From tracker getTransaction — avoids re-fetch in automint gas mirror. */
    maxFeePerGas?: bigint;
    maxPriorityFeePerGas?: bigint;
    gasLimit?: bigint;
}

export type OnMintCallback = (mint: DetectedMint) => void;
export type OnCandidateCallback = (candidate: MintCandidate) => void;

// Known routers where we bypass log-based mint verification
const TRACKER_BYPASS_ROUTERS = new Set([
    '0x00005ea00ac477b1030ce78506496e8c2de24bf5',
    '0x0000000000664ceffed39244a8312556a900b938',
]);

/** Gas fields from a fetched tx — passed through to automint (skip duplicate getTransaction). */
export function gasFieldsFromTransaction(tx: TransactionResponse): Pick<
    DetectedMint,
    'maxFeePerGas' | 'maxPriorityFeePerGas' | 'gasLimit'
> {
    const out: Pick<DetectedMint, 'maxFeePerGas' | 'maxPriorityFeePerGas' | 'gasLimit'> = {};
    if (tx.maxFeePerGas) out.maxFeePerGas = tx.maxFeePerGas;
    if (tx.maxPriorityFeePerGas) {
        out.maxPriorityFeePerGas = tx.maxPriorityFeePerGas;
    } else if (tx.maxFeePerGas) {
        out.maxPriorityFeePerGas = tx.maxFeePerGas / 10n;
    }
    if (tx.gasLimit) out.gasLimit = tx.gasLimit;
    return out;
}

export class MintTracker {
    private httpProvider: JsonRpcProvider;
    private wsProvider: WebSocketProvider | null = null;
    private trackedAddresses: Set<string> = new Set();
    private onMintDetected: OnMintCallback;
    private onCandidate?: OnCandidateCallback;
    private chainId: number;
    private isRunning: boolean = false;

    // HTTP fallback
    private blockHandler: ((blockNumber: number) => void) | null = null;
    private lastProcessedBlock: number = 0;

    // WebSocket state
    private wsUrl: string | null;
    private wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private wsHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
    private wsReconnectAttempts: number = 0;
    private readonly MAX_RECONNECT_DELAY = 30_000;

    // Config
    private enablePending: boolean;
    private enableBlockFallback: boolean;
    private copyUnknownCalls: boolean;

    // Stats
    private stats: TrackerStats = {
        blocksProcessed: 0,
        pendingTxsSeen: 0,
        mintsDetected: 0,
        duplicatesSkipped: 0,
        nonMintsRejected: 0,
        wsConnected: false,
        wsReconnects: 0,
        lastBlockTime: 0,
        lastPendingTime: 0,
        pendingLookupThrottled: 0,
        pendingInFlight: 0,
    };

    private lastTrackedActivityLogMs = 0;
    private readonly usePermissiveClassifier =
        process.env.TRACKER_PERMISSIVE_CLASSIFIER !== 'false';

    /** Prevent duplicate work when WS + HTTP both emit the same block. */
    private blocksInFlight = new Set<number>();

    /** Cap pending getTransaction RPC (mainnet pending firehose). */
    private pendingRpcWindowStart = 0;
    private pendingRpcWindowCount = 0;
    private readonly maxPendingRpcPerSec: number;
    private pendingSkippedSinceLog = 0;
    private lastPendingSkipLogMs = 0;

    private readonly bootedAtMs = Date.now();
    private readonly bootGraceUntilMs: number;
    private readonly maxBlockAgeSec = parseInt(process.env.TRACKER_MAX_BLOCK_AGE_SEC || '90', 10);
    private bootGraceLogged = false;
    private headSynced = false;

    /** When true, mempool pending handler is detached (blocks/confirmed path still runs). */
    private pendingPaused = false;
    private pendingHandler: ((txHash: string) => void) | null = null;

    constructor(
        httpUrl: string,
        onMint: OnMintCallback,
        opts?: { onCandidate?: OnCandidateCallback; chainId?: number }
    ) {
        this.httpProvider = new JsonRpcProvider(httpUrl);
        this.onMintDetected = onMint;
        this.onCandidate = opts?.onCandidate;
        this.chainId = opts?.chainId ?? parseInt(process.env.CHAIN_ID || '1', 10);

        const cfg = getRuntimeConfig();
        this.wsUrl = cfg.wsRpcUrl || null;
        this.enablePending = cfg.enablePendingDetection;
        this.enableBlockFallback = cfg.enableBlockFallback;
        this.copyUnknownCalls = cfg.copyUnknownMintCalls;
        this.maxPendingRpcPerSec = cfg.trackerMaxPendingRpcPerSec;
        this.bootGraceUntilMs = Date.now() + cfg.trackerBootGraceMs;
        this.maxPendingConcurrent = cfg.trackerMaxPendingConcurrent;
    }

    addWallet(address: string) {
        const norm = normalizeTrackedWallet(address);
        this.trackedAddresses.add(norm);
        log('debug', `[Tracker] Now tracking: ${norm} | Total: ${this.trackedAddresses.size}`);
    }

    removeWallet(address: string) {
        const norm = normalizeTrackedWallet(address);
        this.trackedAddresses.delete(norm);
        log('debug', `[Tracker] Removed: ${norm} | Total: ${this.trackedAddresses.size}`);
    }

    getTrackedAddresses(): string[] {
        return Array.from(this.trackedAddresses);
    }

    getStats(): TrackerStats {
        return {
            ...this.stats,
            pendingInFlight: this.pendingInFlight,
        };
    }

    async start() {
        if (this.isRunning) return;
        this.isRunning = true;
        trackerDebugState.setMode(
            this.enablePending && this.wsUrl ? 'hybrid' : this.enablePending ? 'pending' : 'block'
        );

        log(
            'info',
            `[Tracker] Starting… boot grace ${Math.max(0, this.bootGraceUntilMs - Date.now())}ms | ` +
                `max block age ${this.maxBlockAgeSec}s`
        );

        await this.syncHeadPointer('startup');

        // Start WebSocket path if URL is available
        if (this.wsUrl && this.enablePending) {
            await this.connectWebSocket();
        }

        // HTTP block fallback — must run when pending/WS is off, or BLOCK_FALLBACK_ALWAYS_ON=true
        if (this.enableBlockFallback) {
            const cfg = getRuntimeConfig();
            const wsWillDeliverBlocks = Boolean(this.wsUrl && this.enablePending);
            const forceHttpWithWs = process.env.TRACKER_HTTP_BLOCKS_WHEN_WS === 'true';
            const alwaysHttpBlocks = cfg.blockFallbackAlwaysOn;

            if (!wsWillDeliverBlocks || alwaysHttpBlocks || forceHttpWithWs) {
                this.startBlockPolling();
            } else {
                log('info', '[Tracker/Block] HTTP block polling deferred — WS pending path active');
                this.scheduleHttpBlockFallbackIfWsDown();
            }
        }

        const httpBlocks = this.blockHandler ? 'on' : 'off';
        log(
            'info',
            `[Tracker] Started. WS=${this.stats.wsConnected ? 'connected' : 'disabled'} | ` +
                `BlockHTTP=${httpBlocks} | Pending=${this.enablePending} | BlockFallback=${this.enableBlockFallback}`
        );
    }

    /** If WS never connects, enable HTTP block polling so confirmed mints are still detected. */
    private scheduleHttpBlockFallbackIfWsDown(): void {
        const delayMs = parseInt(process.env.TRACKER_HTTP_FALLBACK_DELAY_MS || '8000', 10);
        setTimeout(() => {
            if (!this.isRunning || this.blockHandler) return;
            if (!this.stats.wsConnected) {
                console.warn('[Tracker/Block] WS not connected — enabling HTTP block polling');
                this.startBlockPolling();
            }
        }, delayMs);
    }

    stop() {
        this.isRunning = false;
        trackerDebugState.setMode('stopped');

        // Stop WS
        if (this.wsProvider) {
            this.wsProvider.removeAllListeners();
            this.wsProvider.destroy();
            this.wsProvider = null;
        }
        if (this.wsReconnectTimer) {
            clearTimeout(this.wsReconnectTimer);
            this.wsReconnectTimer = null;
        }
        if (this.wsHeartbeatTimer) {
            clearInterval(this.wsHeartbeatTimer);
            this.wsHeartbeatTimer = null;
        }

        // Stop HTTP
        if (this.blockHandler) {
            this.httpProvider.off('block', this.blockHandler);
            this.blockHandler = null;
        }

        this.stats.wsConnected = false;
        log('info', '[Tracker] Stopped.');
    }

    get running(): boolean {
        return this.isRunning;
    }

    isPendingDetectionPaused(): boolean {
        return this.pendingPaused;
    }

    /** Stop mempool pending RPC load; whale detection continues on confirmed blocks. */
    pausePendingDetection(): boolean {
        if (!this.enablePending || this.pendingPaused) return false;
        this.pendingPaused = true;
        if (this.wsProvider && this.pendingHandler) {
            this.wsProvider.off('pending', this.pendingHandler);
            log('info', '[Tracker] Mempool pending detection paused (RPC relief)');
        }
        return true;
    }

    /** Re-attach pending listener after /freerpc resume or /resume. */
    resumePendingDetection(): boolean {
        if (!this.enablePending || !this.pendingPaused) return false;
        this.pendingPaused = false;
        if (this.wsProvider && this.pendingHandler) {
            this.wsProvider.on('pending', this.pendingHandler);
            log('info', '[Tracker] Mempool pending detection resumed');
        }
        return true;
    }

    // ==========================================
    // WEBSOCKET PATH — Pending TX Detection
    // ==========================================

    /** Set lastProcessedBlock to chain head — only process blocks/mints after deploy. */
    private async syncHeadPointer(reason: string): Promise<void> {
        try {
            const head = await this.httpProvider.getBlockNumber();
            this.lastProcessedBlock = head;
            this.headSynced = true;
            log('info', `[Tracker] Head synced (${reason}) @ block #${head} — older blocks skipped`);
        } catch (err) {
            log('warn', `[Tracker] Head sync failed (${reason}):`, (err as Error).message);
        }
    }

    private inBootGrace(): boolean {
        return Date.now() < this.bootGraceUntilMs;
    }

    private shouldDropReplay(_mint: DetectedMint, _context: string): boolean {
        if (this.inBootGrace()) {
            if (!this.bootGraceLogged) {
                this.bootGraceLogged = true;
                log(
                    'info',
                    `[Tracker] Boot grace active — ignoring stale detections until ${new Date(this.bootGraceUntilMs).toISOString()}`
                );
            }
            return true;
        }
        return false;
    }

    private toMintCandidate(mint: DetectedMint): MintCandidate {
        return {
            chainId: this.chainId,
            sourceTxHash: mint.hash,
            sourceFrom: mint.from,
            txTo: mint.to,
            txData: mint.data,
            txValueWei: mint.value,
            detectionSource: mint.detectionPath === 'pending' ? 'pending' : 'block',
            matchedReason: 'trackedFrom',
            receivedAt: mint.timestamp,
            classificationConfidence: mint.classificationConfidence,
        };
    }

    private emitMint(mint: DetectedMint, context: string): void {
        if (this.shouldDropReplay(mint, context)) return;
        const candidate = this.toMintCandidate(mint);
        trackerDebugState.setLastCandidate(candidate);
        this.onCandidate?.(candidate);
        this.onMintDetected(mint);
    }

    private async connectWebSocket(): Promise<void> {
        if (!this.wsUrl) return;

        try {
            log('info', `[Tracker/WS] Connecting to ${this.wsUrl.slice(0, 30)}...`);
            this.wsProvider = new WebSocketProvider(this.wsUrl);

            // Wait for ready
            await this.wsProvider.ready;
            this.stats.wsConnected = true;
            this.wsReconnectAttempts = 0;

            await this.syncHeadPointer('ws-ready');

            const pendingDelay = parseInt(process.env.TRACKER_PENDING_SUBSCRIBE_DELAY_MS || '3000', 10);
            if (pendingDelay > 0) {
                log('info', `[Tracker/WS] Pending subscribe in ${pendingDelay}ms (mempool flood guard)`);
                await new Promise(r => setTimeout(r, pendingDelay));
            }

            log('info', '[Tracker/WS] Connected. Subscribing to pending transactions...');

            this.pendingHandler = (txHash: string) => {
                if (this.pendingPaused) return;
                this.handlePendingTx(txHash).catch(() => {});
            };
            if (!this.pendingPaused) {
                this.wsProvider.on('pending', this.pendingHandler);
            } else {
                log('info', '[Tracker/WS] Pending subscribe skipped — pending detection paused');
            }

            // Also listen for blocks via WS (faster than HTTP polling)
            this.wsProvider.on('block', (blockNumber: number) => {
                this.handleBlock(blockNumber, 'ws');
            });

            // Monitor for disconnection
            (this.wsProvider.websocket as WebSocket).onclose = () => {
                log('warn', '[Tracker/WS] Connection closed.');
                this.stats.wsConnected = false;
                if (this.enableBlockFallback && !this.blockHandler) {
                    log('warn', '[Tracker/Block] WS closed — enabling HTTP block polling');
                    this.startBlockPolling();
                }
                this.scheduleReconnect();
            };

            (this.wsProvider.websocket as WebSocket).onerror = () => {
                logRateLimited('tracker-ws-error', 30_000, 'error', '[Tracker/WS] Error:', 'websocket error');
                this.stats.wsConnected = false;
            };

            // Start heartbeat
            this.startHeartbeat();

        } catch (err) {
            const e = err as Error;
            log('error', `[Tracker/WS] Connection failed: ${e.message}`);
            this.stats.wsConnected = false;
            this.scheduleReconnect();
        }
    }

    private startHeartbeat(): void {
        if (this.wsHeartbeatTimer) clearInterval(this.wsHeartbeatTimer);

        this.wsHeartbeatTimer = setInterval(async () => {
            if (!this.wsProvider || !this.stats.wsConnected) return;

            try {
                await this.wsProvider.getBlockNumber();
            } catch {
                logRateLimited('tracker-ws-hb-fail', 60_000, 'warn', '[Tracker/WS] Heartbeat failed. Reconnecting...');
                this.stats.wsConnected = false;
                this.wsProvider?.removeAllListeners();
                this.wsProvider?.destroy();
                this.wsProvider = null;
                this.scheduleReconnect();
            }
        }, 30_000); // Every 30 seconds
    }

    private scheduleReconnect(): void {
        if (!this.isRunning || !this.wsUrl) return;
        if (this.wsReconnectTimer) return; // Already scheduled

        this.wsReconnectAttempts++;
        this.stats.wsReconnects++;
        const delay = Math.min(1000 * Math.pow(2, this.wsReconnectAttempts - 1), this.MAX_RECONNECT_DELAY);

        logRateLimited(
            'tracker-ws-reconnect',
            10_000,
            'info',
            `[Tracker/WS] Reconnecting in ${delay}ms (attempt ${this.wsReconnectAttempts})...`
        );

        this.wsReconnectTimer = setTimeout(async () => {
            this.wsReconnectTimer = null;
            if (this.isRunning) {
                await this.connectWebSocket();
            }
        }, delay);
    }

    // Pending tx rate limiter — prevents RPC exhaustion on free-tier nodes
    private pendingInFlight: number = 0;
    private readonly maxPendingConcurrent: number;
    private pendingSkipped: number = 0;

    private consumePendingRpcBudget(): boolean {
        const now = Date.now();
        if (now - this.pendingRpcWindowStart >= 1000) {
            this.pendingRpcWindowStart = now;
            this.pendingRpcWindowCount = 0;
        }
        if (this.pendingRpcWindowCount >= this.maxPendingRpcPerSec) {
            return false;
        }
        this.pendingRpcWindowCount++;
        return true;
    }

    private notePendingSkipped(): void {
        this.pendingSkipped++;
        this.stats.pendingLookupThrottled++;
        this.pendingSkippedSinceLog++;
        const now = Date.now();
        if (now - this.lastPendingSkipLogMs > 60_000) {
            this.lastPendingSkipLogMs = now;
            logRateLimited(
                'tracker-pending-skip',
                60_000,
                'info',
                `[Tracker/Pending] Throttled ${this.pendingSkippedSinceLog} pending RPC lookups (cap ${this.maxPendingRpcPerSec}/s)`
            );
            this.pendingSkippedSinceLog = 0;
        }
    }

    private async handlePendingTx(txHash: string): Promise<void> {
        if (this.trackedAddresses.size === 0) return;

        if (!this.consumePendingRpcBudget()) {
            this.notePendingSkipped();
            return;
        }

        // Rate limit: skip if too many pending fetches are in flight
        if (this.pendingInFlight >= this.maxPendingConcurrent) {
            this.notePendingSkipped();
            return;
        }

        this.stats.pendingTxsSeen++;
        this.pendingInFlight++;

        try {
            // Fetch the pending transaction
            const tx = await this.httpProvider.getTransaction(txHash);
            if (!tx || !tx.from || !tx.to) return;

            // Already mined — stale mempool notification after restart
            if (tx.blockNumber != null) {
                markTxSeenIfNew(txHash, 'confirmed');
                return;
            }

            const fromLower = tx.from.toLowerCase();
            if (!this.trackedAddresses.has(fromLower)) return;

            const classification = this.usePermissiveClassifier
                ? classifyTrackedWalletTx(tx.data, tx.value.toString(), tx.to)
                : classifyMintTransaction(tx.data, tx.value.toString(), tx.to, this.copyUnknownCalls);

            if (!classification.isMint) {
                this.stats.nonMintsRejected++;
                trackerDebugState.setLastSkipReason('classifierRejected');
                return;
            }

            // Mark once — prevents pending + confirmed double-fire
            if (!markTxSeenIfNew(txHash, 'pending')) {
                this.stats.duplicatesSkipped++;
                trackerDebugState.incrementDuplicates();
                trackerDebugState.setLastSkipReason('duplicateTx');
                return;
            }

            this.stats.mintsDetected++;
            this.stats.lastPendingTime = Date.now();

            log(
                'info',
                `[Tracker/Pending] 🚀 WHALE MINT (mempool) ${txHash.slice(0, 12)}… | ${tx.from.slice(0, 10)} → ${tx.to.slice(0, 10)} | ${classification.confidence}`
            );

            this.emitMint(
                {
                    hash: tx.hash,
                    from: tx.from,
                    to: tx.to,
                    value: tx.value.toString(),
                    data: tx.data,
                    timestamp: Date.now(),
                    classificationConfidence: classification.confidence,
                    detectionPath: 'pending',
                    ...gasFieldsFromTransaction(tx),
                },
                'pending'
            );

        } catch {
            trackerDebugState.incrementRpcErrors();
            // Silently ignore — pending txs can disappear before we fetch them
        } finally {
            this.pendingInFlight--;
        }
    }

    // ==========================================
    // HTTP BLOCK PATH — Confirmed Detection (Fallback)
    // ==========================================

    /**
     * Resolve full transaction objects from a block.
     * Some RPCs return hash-only in getBlock(true); fetch only txs from tracked wallets.
     */
    private async resolveBlockTransactions(
        block: Awaited<ReturnType<JsonRpcProvider['getBlock']>>,
        fetchWithRetry: <T>(fetcher: () => Promise<T>) => Promise<T>
    ): Promise<TransactionResponse[]> {
        if (!block) return [];

        try {
            const prefetched = block.prefetchedTransactions;
            if (prefetched?.length) {
                return prefetched.filter(
                    tx => tx?.from && this.trackedAddresses.has(tx.from.toLowerCase())
                );
            }
        } catch {
            // Hash-only block — fall through
        }

        const hashes = block.transactions;
        if (!hashes?.length) return [];

        const resolved: TransactionResponse[] = [];
        const maxFetch = parseInt(process.env.TRACKER_MAX_TX_FETCH_PER_BLOCK || '80', 10);

        for (let i = 0; i < hashes.length && resolved.length < maxFetch; i++) {
            const entry = hashes[i] as string | TransactionResponse;
            if (typeof entry !== 'string') {
                if (entry?.from) resolved.push(entry);
                continue;
            }
            try {
                const tx = await fetchWithRetry(() => this.httpProvider.getTransaction(entry));
                if (tx?.from && this.trackedAddresses.has(tx.from.toLowerCase())) {
                    resolved.push(tx);
                }
            } catch {
                // skip single tx
            }
        }

        if (resolved.length > 0) {
            logRateLimited(
                'tracker-block-resolve',
                30_000,
                'debug',
                `[Tracker/Block] Resolved ${resolved.length} tracked tx(s) (block #${block.number})`
            );
        }
        return resolved;
    }

    private startBlockPolling(): void {
        log('info', `[Tracker/Block] Starting HTTP block polling…`);

        if (!this.headSynced) {
            void this.syncHeadPointer('http-poll').then(() => {
                log('info', `[Tracker/Block] Polling active from block #${this.lastProcessedBlock}`);
            });
        }

        this.blockHandler = (blockNumber: number) => {
            this.handleBlock(blockNumber, 'http');
        };
        this.httpProvider.on('block', this.blockHandler);
    }

    private async handleBlock(blockNumber: number, source: 'http' | 'ws'): Promise<void> {
        if (blockNumber <= this.lastProcessedBlock) return;

        if (this.blocksInFlight.has(blockNumber)) return;
        this.blocksInFlight.add(blockNumber);

        if (this.trackedAddresses.size === 0) {
            this.lastProcessedBlock = blockNumber;
            this.blocksInFlight.delete(blockNumber);
            return;
        }

        const fetchWithRetry = async <T>(fetcher: () => Promise<T>, retries = 5, delayMs = 1200): Promise<T> => {
            for (let i = 0; i < retries; i++) {
                try {
                    return await fetcher();
                } catch (e: unknown) {
                    if (i < retries - 1 && isRateLimitedRpcError(e)) {
                        await new Promise(r => setTimeout(r, delayMs));
                        delayMs = Math.min(delayMs * 2, 12_000);
                        continue;
                    }
                    throw e;
                }
            }
            throw new Error('Retry exhausted');
        };

        try {
            const block = await fetchWithRetry(() => this.httpProvider.getBlock(blockNumber, true));
            if (!block) {
                this.lastProcessedBlock = blockNumber;
                return;
            }

            const blockTs = Number(block.timestamp ?? 0);
            const blockAgeSec = blockTs > 0 ? Math.floor(Date.now() / 1000) - blockTs : 0;
            if (this.maxBlockAgeSec > 0 && blockAgeSec > this.maxBlockAgeSec) {
                logRateLimited(
                    'tracker-stale-block',
                    60_000,
                    'info',
                    `[Tracker/Block] Skip #${blockNumber} — block age ${blockAgeSec}s > ${this.maxBlockAgeSec}s (replay guard)`
                );
                this.lastProcessedBlock = blockNumber;
                this.stats.blocksProcessed++;
                return;
            }

            const txs = await this.resolveBlockTransactions(block, fetchWithRetry);
            if (txs.length === 0) {
                this.lastProcessedBlock = blockNumber;
                this.stats.blocksProcessed++;
                this.stats.lastBlockTime = Date.now();
                return;
            }

            for (const tx of txs) {
                if (!tx?.from) continue;

                const fromLower = tx.from.toLowerCase();
                if (!this.trackedAddresses.has(fromLower)) continue;

                // Skip simple ETH transfers
                if (!tx.data || tx.data === '0x') continue;

                if (!markTxSeenIfNew(tx.hash, 'confirmed')) {
                    this.stats.duplicatesSkipped++;
                    trackerDebugState.incrementDuplicates();
                    trackerDebugState.setLastSkipReason('duplicateTx');
                    continue;
                }

                const classification = this.usePermissiveClassifier
                    ? classifyTrackedWalletTx(tx.data, tx.value.toString(), tx.to)
                    : classifyMintTransaction(tx.data, tx.value.toString(), tx.to, this.copyUnknownCalls);

                if (!classification.isMint) {
                    this.stats.nonMintsRejected++;
                    trackerDebugState.setLastSkipReason('classifierRejected');
                    const now = Date.now();
                    if (now - this.lastTrackedActivityLogMs > 120_000) {
                        this.lastTrackedActivityLogMs = now;
                        logRateLimited(
                            'tracker-block-reject',
                            120_000,
                            'debug',
                            `[Tracker/Block] Rejected tracked tx ${tx.hash.slice(0, 12)} | ${classification.reason}`
                        );
                    }
                    continue;
                }

                // Receipt log verification (off by default — many mints use non-standard events)
                const skipReceiptVerify =
                    process.env.SKIP_CONFIRMED_RECEIPT_VERIFY !== 'false' ||
                    classification.confidence === 'high' ||
                    classification.confidence === 'medium';

                if (!skipReceiptVerify && tx.to && !TRACKER_BYPASS_ROUTERS.has(tx.to.toLowerCase())) {
                    try {
                        const receipt = await fetchWithRetry(() => this.httpProvider.getTransactionReceipt(tx.hash));
                        if (!receipt) continue;

                        const transferTopic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
                        const transferSingleTopic = "0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62";
                        const transferBatchTopic = "0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb";
                        const isZeroTopic = (topic: string | undefined) => {
                            if (!topic) return false;
                            const t = topic.toLowerCase();
                            return (
                                t ===
                                    '0x0000000000000000000000000000000000000000000000000000000000000000' ||
                                t.endsWith('0000000000000000000000000000000000000000')
                            );
                        };

                        let isMintVerified = false;
                        for (const log of receipt.logs) {
                            const t0 = log.topics[0];
                            if (t0 === transferTopic && isZeroTopic(log.topics[1])) {
                                isMintVerified = true;
                                break;
                            }
                            if (t0 === transferSingleTopic && isZeroTopic(log.topics[2])) {
                                isMintVerified = true;
                                break;
                            }
                            if (t0 === transferBatchTopic && isZeroTopic(log.topics[2])) {
                                isMintVerified = true;
                                break;
                            }
                        }

                        if (!isMintVerified) {
                            this.stats.nonMintsRejected++;
                            continue;
                        }
                    } catch (err) {
                        logRateLimited(
                            `tracker-receipt-${tx.hash.slice(0, 10)}`,
                            60_000,
                            'warn',
                            `[Tracker/Block] Receipt fetch failed for ${tx.hash.slice(0, 12)}:`,
                            (err as Error).message
                        );
                        continue;
                    }
                }

                this.stats.mintsDetected++;
                log(
                    'info',
                    `[Tracker/Block] ✅ Whale MINT #${blockNumber} | ${tx.hash.slice(0, 12)}… | ${tx.from.slice(0, 10)}`
                );

                this.emitMint(
                    {
                        hash: tx.hash,
                        from: tx.from,
                        to: tx.to || '',
                        value: tx.value.toString(),
                        data: tx.data,
                        timestamp: Date.now(),
                        classificationConfidence: classification.confidence,
                        detectionPath: 'confirmed',
                        ...gasFieldsFromTransaction(tx),
                    },
                    'confirmed'
                );
            }

            this.lastProcessedBlock = blockNumber;
            this.stats.blocksProcessed++;
            this.stats.lastBlockTime = Date.now();

            const heartbeatEvery = parseInt(process.env.TRACKER_HEARTBEAT_EVERY_BLOCKS || '500', 10);
            if (heartbeatEvery > 0 && this.stats.blocksProcessed % heartbeatEvery === 0) {
                logRateLimited(
                    'tracker-heartbeat',
                    120_000,
                    'info',
                    `[Tracker/Heartbeat] #${blockNumber} (${source}) | blocks=${this.stats.blocksProcessed} mints=${this.stats.mintsDetected} tracking=${this.trackedAddresses.size}`
                );
            }
        } catch (err) {
            const msg = (err as Error).message || String(err);
            logRateLimited(`tracker-block-err-${blockNumber}`, 30_000, 'warn', `[Tracker/Block] Error #${blockNumber}:`, msg);
            if (isRateLimitedRpcError(err) && this.isRunning) {
                const retryMs = parseInt(process.env.TRACKER_BLOCK_RETRY_MS || '5000', 10);
                logRateLimited('tracker-block-retry', 15_000, 'warn', `[Tracker/Block] Re-queue #${blockNumber} in ${retryMs}ms (RPC 429)`);
                setTimeout(() => {
                    if (this.isRunning && blockNumber > this.lastProcessedBlock) {
                        this.handleBlock(blockNumber, source).catch(() => {});
                    }
                }, retryMs);
            }
        } finally {
            this.blocksInFlight.delete(blockNumber);
        }
    }
}
