/**
 * ETH sweep from sub-wallets → destination. Deduped per user to stop webhook retry / double-tap spam.
 */
import { Wallet, formatEther, type JsonRpcProvider } from 'ethers';

const SWEEP_COOLDOWN_MS = parseInt(process.env.SWEEP_COOLDOWN_MS || '120000', 10);
const activeByUser = new Map<string, number>();

export function tryAcquireSweepLock(userId: string): { ok: true } | { ok: false; retrySec: number } {
    const now = Date.now();
    const until = activeByUser.get(userId) ?? 0;
    if (until > now) {
        return { ok: false, retrySec: Math.ceil((until - now) / 1000) };
    }
    activeByUser.set(userId, now + SWEEP_COOLDOWN_MS);
    return { ok: true };
}

export function releaseSweepLock(userId: string): void {
    activeByUser.delete(userId);
}

export function isSweepInProgress(userId: string): boolean {
    const until = activeByUser.get(userId) ?? 0;
    return until > Date.now();
}

export type SweepWallet = { address: string; privateKey: string };

export type SweepEthParams = {
    userId: string;
    provider: JsonRpcProvider;
    destination: string;
    wallets: SweepWallet[];
    onStatus: (html: string) => Promise<void>;
};

export async function runTurboSweep(params: SweepEthParams): Promise<void> {
    const lock = tryAcquireSweepLock(params.userId);
    if (!lock.ok) {
        await params.onStatus(
            `⏳ <b>Sweep already running</b>\n\n` +
                `Wait <b>${lock.retrySec}s</b> before starting another sweep (prevents duplicate broadcasts).`
        );
        return;
    }

    const destLower = params.destination.toLowerCase();
    const walletsToSweep = params.wallets.filter(w => w.address.toLowerCase() !== destLower);

    if (walletsToSweep.length === 0) {
        releaseSweepLock(params.userId);
        await params.onStatus('ℹ️ All wallets match the destination — nothing to sweep.');
        return;
    }

    await params.onStatus(
        `🚀 <b>Turbo-Sweep started</b>\n` +
            `Broadcasting up to <b>${walletsToSweep.length}</b> tx(s) → <code>${params.destination.slice(0, 10)}…</code>`
    );

    try {
        const balanceProms = walletsToSweep.map(async w => {
            const bal = await params.provider.getBalance(w.address);
            return { ...w, actualBalance: bal };
        });
        const walletsWithBal = await Promise.all(balanceProms);
        const activeWallets = walletsWithBal.filter(w => w.actualBalance > 0n);

        if (activeWallets.length === 0) {
            await params.onStatus('ℹ️ <b>Nothing to sweep.</b>\nAll sub-wallets have 0 ETH balance.');
            return;
        }

        const feeData = await params.provider.getFeeData();
        const gasPrice = feeData.maxFeePerGas || feeData.gasPrice || 1_000_000_000n;
        const gasCost = gasPrice * 21_000n;

        let sentCount = 0;
        let totalVal = 0n;
        const txPromises: Promise<{ hash?: string }>[] = [];

        for (const w of activeWallets) {
            if (w.actualBalance <= gasCost) continue;

            try {
                const wallet = new Wallet(w.privateKey, params.provider);
                const sendAmount = w.actualBalance - gasCost;
                const tx = wallet.sendTransaction({
                    to: params.destination,
                    value: sendAmount,
                    maxFeePerGas: feeData.maxFeePerGas ?? undefined,
                    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ?? undefined,
                    gasLimit: 21_000n,
                    type: 2,
                });
                txPromises.push(tx);
                sentCount++;
                totalVal += sendAmount;
                await new Promise(r => setTimeout(r, 100));
            } catch (e) {
                console.error(`[Sweep] Failed to broadcast ${w.address.slice(0, 10)}:`, e);
            }
        }

        await params.onStatus(
            `⏳ <b>Broadcast complete</b>\n` +
                `Submitted <b>${sentCount}</b> tx(s) · <b>${formatEther(totalVal)}</b> ETH\n` +
                `<i>Waiting for confirmations…</i>`
        );

        const results = await Promise.allSettled(txPromises);
        const successCount = results.filter(r => r.status === 'fulfilled').length;

        await params.onStatus(
            `✅ <b>Turbo-Sweep complete</b>\n\n` +
                `🏁 <code>${params.destination.slice(0, 10)}…</code>\n` +
                `👛 Cleared: <b>${successCount}</b> / ${activeWallets.length}\n` +
                `💰 Reclaimed: <b>${formatEther(totalVal)} ETH</b>`
        );
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        await params.onStatus(`❌ <b>Sweep failed</b>\n${msg.slice(0, 200)}`);
    } finally {
        releaseSweepLock(params.userId);
    }
}
