import type { JsonRpcProvider } from 'ethers';
import { InclusionRouter } from './inclusion/InclusionRouter';
import type { WalletExecutionPlan, WalletReceipt } from '../types/copyMint';
import type { InclusionBroadcastOptions } from '../types/inclusion';

export class BroadcastService {
    static async broadcastPlan(
        provider: JsonRpcProvider,
        plan: WalletExecutionPlan,
        opts?: InclusionBroadcastOptions | boolean
    ): Promise<WalletReceipt> {
        const inclusionOpts: InclusionBroadcastOptions | undefined =
            typeof opts === 'boolean' ? { mevProtection: opts } : opts;
        return InclusionRouter.broadcastPlan(provider, plan, inclusionOpts);
    }

    static async broadcastBundle(
        provider: JsonRpcProvider,
        plans: WalletExecutionPlan[],
        opts?: InclusionBroadcastOptions
    ): Promise<WalletReceipt[]> {
        return InclusionRouter.broadcastBundle(provider, plans, opts);
    }
}
