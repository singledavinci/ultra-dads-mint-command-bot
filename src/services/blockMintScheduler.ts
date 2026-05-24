/**
 * Block-targeted mint scheduler — fire txs when a specific block arrives.
 *
 * Built for contracts like OEGP (0x460d7…) with per-block mint caps (`freePlanting()`).
 */
import { formatEther, Interface, JsonRpcProvider, parseEther, Wallet } from 'ethers';
import { CopyMintEngine } from '../engine/CopyMintEngine';
import { DetectionEngine } from '../engine/DetectionEngine';
import { log, logRateLimited } from '../utils/logger';
import { resolveDropMintAtFireTime, scheduledDropExecuteOptions } from './scheduledDropResolver.js';
import { loadLinkMintConfig } from './linkMintService.js';
import {
    buildSeaDropLinkMint,
    findSeaDropPublicDrop,
    seaDropPublicMintBlockedReason,
} from './seaDropBuilder';
import { resolveSeaDropMint } from './seaDropMintResolver.js';
import {
    detectMintInfo,
    detectRecentDirectMintPattern,
    encodeDirectMintCalldata,
} from './mintPriceDetector';
import type { BlockMintJob } from '../bot/stateManager';
import { OEGP_CONTRACT, parseBlockTarget } from './blockMintTargets';

export { OEGP_CONTRACT, parseBlockTarget };

const OEGP_IFACE = new Interface(['function freePlanting()']);

const jobs = new Map<string, BlockMintJob>();
const listeners = new Map<
    string,
    { provider: JsonRpcProvider; handler: (blockNumber: number) => void }
>();

export function getActiveBlockMintJobs(): BlockMintJob[] {
    return Array.from(jobs.values()).filter(j => !j.fired && !j.cancelled);
}

export async function resolveBlockMintCalldata(params: {
    contract: string;
    mintMode: string;
    rawData?: string;
    valueEth?: string;
    provider: JsonRpcProvider;
    minterAddress?: string;
}): Promise<{ data: string; valueEth: string; label: string; executionTo: string }> {
    const contract = params.contract.toLowerCase();
    const mode = params.mintMode.toLowerCase();

    if (mode === 'oegp' || mode === 'free') {
        if (contract === OEGP_CONTRACT || mode === 'oegp') {
            return {
                data: OEGP_IFACE.encodeFunctionData('freePlanting', []),
                valueEth: '0',
                label: 'OEGP freePlanting()',
                executionTo: contract,
            };
        }
    }

    if (mode === 'raw') {
        if (!params.rawData?.startsWith('0x')) throw new Error('raw mode requires calldata 0x…');
        return {
            data: params.rawData,
            valueEth: params.valueEth || '0',
            label: 'raw calldata',
            executionTo: contract,
        };
    }

    if (mode === 'auto' && params.minterAddress) {
        const seaResolved = await resolveSeaDropMint({
            nftContract: contract,
            minter: params.minterAddress,
            quantity: 1,
            provider: params.provider,
        });
        if (seaResolved) {
            const v =
                seaResolved.value === '0' || seaResolved.value === '0x0'
                    ? '0'
                    : formatEther(
                          BigInt(
                              seaResolved.value.startsWith('0x')
                                  ? seaResolved.value
                                  : seaResolved.value
                          )
                      );
            return {
                data: seaResolved.data,
                valueEth: params.valueEth || v,
                label: `SeaDrop ${seaResolved.phase}`,
                executionTo: seaResolved.to,
            };
        }

        const recentDirect = await detectRecentDirectMintPattern(contract, params.provider);
        if (recentDirect) {
            return {
                data: encodeDirectMintCalldata(recentDirect.selector, 1),
                valueEth: params.valueEth || '0',
                label: `direct ${recentDirect.functionName}`,
                executionTo: contract,
            };
        }

        const drop = await findSeaDropPublicDrop(contract, params.provider);
        if (drop && !seaDropPublicMintBlockedReason(drop)) {
            const sea = await buildSeaDropLinkMint(contract, params.minterAddress, 1, params.provider);
            if (sea) {
                return {
                    data: sea.data,
                    valueEth: formatEther(sea.value || '0x0'),
                    label: `SeaDrop ${sea.functionName}`,
                    executionTo: sea.to,
                };
            }
        }
    }

    const info = await detectMintInfo(params.contract, params.provider, 1, params.minterAddress);
    if (!info) {
        throw new Error('Could not detect mint function — use mode free/oegp/raw 0x…');
    }

    const data = encodeDirectMintCalldata(info.mintSelector, 1);

    return {
        data,
        valueEth: params.valueEth ?? info.priceEth,
        label: info.mintFunctionName,
        executionTo: contract,
    };
}

export interface BlockMintFireContext {
    provider: JsonRpcProvider;
    privateKeys: string[];
    options: Record<string, unknown>;
    notify: (html: string) => Promise<void>;
    /** Optional — wait for receipts, NFT metadata, compact admin report */
    onResults?: (
        results: PromiseSettledResult<unknown>[],
        job: BlockMintJob,
        blockNumber: number
    ) => Promise<void>;
    onComplete?: (job: BlockMintJob) => Promise<void>;
}

async function fireJob(job: BlockMintJob, blockNumber: number, ctx: BlockMintFireContext): Promise<void> {
    if (!ctx.privateKeys.length) {
        await ctx.notify('⚠️ Block mint aborted — no wallets.');
        job.fired = true;
        job.cancelled = true;
        disarmBlockMint(job.id);
        return;
    }

    log('info', `[BlockMint] Firing ${job.id} at block #${blockNumber} → ${job.contract.slice(0, 10)}…`);

    await ctx.notify(
        `⛏️ <b>Block mint</b> #${blockNumber}\n` +
            `<code>${job.contract}</code>\n` +
            `${job.label} · ${job.valueEth} ETH × ${ctx.privateKeys.length} wallet(s)`
    );

    try {
        let executionTo = job.executionTo || job.contract;
        let data = job.data;
        let valueEth = job.valueEth;
        let scatterSlug: string | undefined;
        let seaDropNft: string | undefined;

        const minterWallet = ctx.privateKeys[0]
            ? new Wallet(ctx.privateKeys[0], ctx.provider).address
            : undefined;

        let resolvedExec: Awaited<ReturnType<typeof resolveDropMintAtFireTime>> | undefined;

        if (minterWallet) {
            try {
                const valueEthIsHint = parseFloat(job.valueEth) > 0;
                resolvedExec = await resolveDropMintAtFireTime({
                    sourceInput: job.sourceInput || job.contract,
                    provider: ctx.provider,
                    minter: minterWallet,
                    valueEthHint: job.valueEth,
                    valueEthIsHint,
                });
                executionTo = resolvedExec.executionTo;
                data = resolvedExec.data;
                valueEth = resolvedExec.valueEth;
                scatterSlug = resolvedExec.scatterSlug;
                seaDropNft = resolvedExec.seaDropNftContract;
            } catch (e: unknown) {
                logRateLimited(
                    `blockmint-resolve-${job.id}`,
                    30_000,
                    'warn',
                    `[BlockMint] Fire-time resolve fallback for ${job.id}:`,
                    (e as Error).message?.slice(0, 120)
                );
            }
        }

        const valueWei = parseEther(valueEth).toString();
        const linkCfg = loadLinkMintConfig();
        const dropOpts = resolvedExec
            ? scheduledDropExecuteOptions(resolvedExec, linkCfg)
            : {
                  scatterSlug,
                  seaDropNftContract: seaDropNft,
                  skipClassification: true,
                  skipSimulation: linkCfg.simulationMode === 'fast',
                  forceGasEstimate: true,
              };

        const engineResult = await CopyMintEngine.executeScheduledMint({
            provider: ctx.provider,
            privateKeys: ctx.privateKeys,
            candidate: DetectionEngine.candidateFromManual({
                to: executionTo,
                data,
                value: valueWei,
            }),
            paymentPlanValue: valueWei,
            options: {
                ...ctx.options,
                ...dropOpts,
            },
        });

        const results = engineResult.legacyResults;
        if (ctx.onResults) {
            await ctx.onResults(results as PromiseSettledResult<unknown>[], job, blockNumber);
        } else {
            let lines = '';
            let ok = 0;
            results.forEach((res, i) => {
                if (res.status === 'fulfilled' && res.value) {
                    ok++;
                    const hash = (res.value as { hash?: string }).hash;
                    lines += `W#${i + 1}: <a href="https://etherscan.io/tx/${hash}">tx</a>\n`;
                } else {
                    const msg =
                        res.status === 'rejected'
                            ? String((res as PromiseRejectedResult).reason?.message || 'failed').slice(0, 80)
                            : CopyMintEngine.getLastSkipReason() || 'skipped';
                    lines += `W#${i + 1}: ❌ ${msg}\n`;
                }
            });
            await ctx.notify(
                `✅ <b>Block #${blockNumber}</b> — ${ok}/${results.length} submitted\n${lines || '<i>No txs</i>'}`
            );
        }
    } catch (err: unknown) {
        const msg = (err as Error).message || String(err);
        await ctx.notify(`❌ Block mint failed @ #${blockNumber}: ${msg.slice(0, 120)}`);
        logRateLimited(`blockmint-fail-${job.id}`, 10_000, 'warn', `[BlockMint] ${job.id} failed:`, msg);
    }
}

export function armBlockMint(job: BlockMintJob, ctx: BlockMintFireContext): void {
    if (job.fired || job.cancelled) return;

    jobs.set(job.id, job);

    const handler = (blockNumber: number) => {
        const j = jobs.get(job.id);
        if (!j || j.fired || j.cancelled) return;

        if (j.strategy === 'once') {
            if (blockNumber < j.targetBlock) return;
            void fireJob(j, blockNumber, ctx).finally(async () => {
                j.fired = true;
                disarmBlockMint(j.id);
                await ctx.onComplete?.(j);
            });
            return;
        }

        // every — one attempt per block
        if (blockNumber < j.targetBlock) return;
        if (j.blocksRemaining <= 0) {
            j.fired = true;
            disarmBlockMint(j.id);
            void ctx.onComplete?.(j);
            return;
        }

        void fireJob(j, blockNumber, ctx).finally(async () => {
            j.blocksRemaining -= 1;
            if (j.blocksRemaining <= 0) {
                j.fired = true;
                disarmBlockMint(j.id);
                await ctx.onComplete?.(j);
            } else {
                await ctx.onComplete?.(j);
            }
        });
    };

    ctx.provider.on('block', handler);
    listeners.set(job.id, { provider: ctx.provider, handler });

    log(
        'info',
        `[BlockMint] Armed ${job.id} | ${job.strategy} | target #${job.targetBlock}` +
            (job.strategy === 'every' ? ` × ${job.blocksRemaining} blocks` : '')
    );
}

export function disarmBlockMint(id: string): void {
    const listener = listeners.get(id);
    if (listener) {
        listener.provider.off('block', listener.handler);
        listeners.delete(id);
    }
    jobs.delete(id);
}

export function cancelBlockMint(id: string): boolean {
    const job = jobs.get(id);
    if (!job) return false;
    job.cancelled = true;
    job.fired = true;
    disarmBlockMint(id);
    return true;
}

/** Cancel every armed block mint job and remove block listeners (frees RPC). */
export function cancelAllBlockMints(stored?: BlockMintJob[]): number {
    const ids = new Set<string>([...listeners.keys(), ...jobs.keys()]);
    if (stored) {
        for (const job of stored) {
            if (job.fired || job.cancelled) continue;
            job.cancelled = true;
            job.fired = true;
            ids.add(job.id);
        }
    }
    for (const id of ids) {
        disarmBlockMint(id);
    }
    return ids.size;
}

export function rearmBlockMints(
    stored: BlockMintJob[],
    ctxFactory: (job: BlockMintJob) => BlockMintFireContext
): void {
    for (const job of stored) {
        if (job.fired || job.cancelled) continue;
        armBlockMint(job, ctxFactory(job));
    }
}
