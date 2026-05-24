import { extractScatterSlug, resolveScatterLinkMint } from '../../services/scatterMint.js';
import type { SignatureMintAttempt, SignatureMintContext, SignatureMintStrategy } from './types.js';

export const scatterApiStrategy: SignatureMintStrategy = {
    name: 'scatter_api',

    async tryBuild(ctx: SignatureMintContext): Promise<SignatureMintAttempt> {
        const hint = (ctx.detected as { sourceUrl?: string }).sourceUrl || '';
        const slug =
            extractScatterSlug(hint) || extractScatterSlug(process.env.SCATTER_COLLECTION_SLUG || '');
        if (!slug) {
            return { ok: false, method: 'scatter_api', reason: 'No Scatter collection slug in URL or SCATTER_COLLECTION_SLUG' };
        }

        const built = await resolveScatterLinkMint({
            slug,
            minterAddress: ctx.signerAddress,
            quantity: ctx.quantity,
            affiliateAddress: process.env.SCATTER_AFFILIATE_ADDRESS?.trim(),
        });
        if (!built) {
            return { ok: false, method: 'scatter_api', reason: 'Scatter API could not build mint (no list or mint endpoint failed)' };
        }

        return {
            ok: true,
            method: 'scatter_api',
            reason: `Scatter: ${built.collection.name || slug}`,
            plan: {
                tokenContract: built.collection.address,
                executionTarget: built.tx.to,
                calldata: built.tx.data,
                value: built.tx.value,
                functionName: 'scatter_mint',
                selector: built.tx.data.slice(0, 10).toLowerCase(),
                mintType: BigInt(built.tx.value || '0') > 0n ? 'paid' : 'free',
                category: 'CONDITIONAL',
                confidence: 'high',
            },
        };
    },
};
