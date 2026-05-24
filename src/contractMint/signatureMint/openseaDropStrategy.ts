import type { SignatureMintAttempt, SignatureMintContext, SignatureMintStrategy } from './types.js';
import { resolveOpenSeaSlugFromContract } from './slugResolver.js';

export const openseaDropStrategy: SignatureMintStrategy = {
    name: 'opensea_drop_api',

    async tryBuild(ctx: SignatureMintContext): Promise<SignatureMintAttempt> {
        if (!process.env.OPENSEA_API_KEY?.trim() && process.env.SIGNATURE_MINT_REQUIRE_OPENSEA_KEY === 'true') {
            return { ok: false, method: 'opensea_drop_api', reason: 'OPENSEA_API_KEY not set' };
        }

        const slug = await resolveOpenSeaSlugFromContract(ctx.detected.tokenContract, ctx.chainId);
        if (!slug) {
            return { ok: false, method: 'opensea_drop_api', reason: 'No OpenSea slug for contract' };
        }

        try {
            const url = `https://api.opensea.io/api/v2/drops/${encodeURIComponent(slug)}/mint`;
            const headers: Record<string, string> = {
                accept: 'application/json',
                'content-type': 'application/json',
            };
            const apiKey = process.env.OPENSEA_API_KEY?.trim();
            if (apiKey) headers['x-api-key'] = apiKey;

            const res = await fetch(url, {
                method: 'POST',
                headers,
                body: JSON.stringify({ minter: ctx.signerAddress, quantity: ctx.quantity }),
                signal: AbortSignal.timeout(15_000),
            });

            if (!res.ok) {
                const errText = await res.text().catch(() => '');
                return {
                    ok: false,
                    method: 'opensea_drop_api',
                    reason: `OpenSea mint API ${res.status}: ${errText.slice(0, 120)}`,
                };
            }

            const json = (await res.json()) as { to?: string; data?: string; value?: string };
            if (!json.to || !json.data) {
                return { ok: false, method: 'opensea_drop_api', reason: 'OpenSea response missing to/data' };
            }

            let value = json.value || '0x0';
            if (!value.startsWith('0x')) value = '0x' + BigInt(value).toString(16);

            return {
                ok: true,
                method: 'opensea_drop_api',
                reason: `OpenSea drop mint (${slug})`,
                plan: {
                    tokenContract: ctx.detected.tokenContract,
                    executionTarget: json.to.toLowerCase(),
                    calldata: json.data,
                    value,
                    functionName: 'opensea_drop_mint',
                    selector: json.data.slice(0, 10).toLowerCase(),
                    mintType: BigInt(value) > 0n ? 'paid' : 'free',
                    category: 'CONDITIONAL',
                    confidence: 'high',
                },
            };
        } catch (e) {
            return {
                ok: false,
                method: 'opensea_drop_api',
                reason: `OpenSea API error: ${(e as Error).message?.slice(0, 100)}`,
            };
        }
    },
};