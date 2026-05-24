import { JsonRpcProvider } from 'ethers';
import type { WalletExecutionPlan, WalletReceipt } from '../../types/copyMint';
import { PublicBroadcastAdapter } from './PublicBroadcastAdapter';

const MEV_BLOCKER_RPC = 'https://rpc.mevblocker.io';

/**
 * Routes txs through MEV Blocker (anti-sandwich). Not for competitive FCFS sniping.
 */
export class MevBlockerAdapter {
    static async broadcast(
        primaryProvider: JsonRpcProvider,
        plan: WalletExecutionPlan
    ): Promise<WalletReceipt> {
        const mevProvider = new JsonRpcProvider(MEV_BLOCKER_RPC) as JsonRpcProvider;
        const receipt = await PublicBroadcastAdapter.broadcast(mevProvider, plan);

        if (receipt.status === 'failed' && receipt.errorMessage) {
            const msg = receipt.errorMessage.toLowerCase();
            if (!msg.includes('insufficient funds')) {
                return PublicBroadcastAdapter.broadcast(primaryProvider, plan);
            }
        }

        return receipt;
    }
}
