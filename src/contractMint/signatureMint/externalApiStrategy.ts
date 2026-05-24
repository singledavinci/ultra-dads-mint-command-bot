import type { SignatureMintAttempt, SignatureMintContext, SignatureMintStrategy } from './types.js';

function parseApiList(): string[] {
    const raw = process.env.MINT_SIGNATURE_API_URLS || '';
    return raw.split(/[\n,;]/).map(s => s.trim()).filter(Boolean);
}

function applyTemplate(url: string, ctx: SignatureMintContext): string {
    return url
        .replace(/\{address\}/gi, ctx.signerAddress)
        .replace(/\{contract\}/gi, ctx.detected.tokenContract)
        .replace(/\{quantity\}/gi, String(ctx.quantity))
        .replace(/\{chainId\}/gi, String(ctx.chainId))
        .replace(/\{whale\}/gi, ctx.detected.whaleAddress || '');
}

export const externalApiStrategy: SignatureMintStrategy = {
    name: 'external_api',

    async tryBuild(ctx: SignatureMintContext): Promise<SignatureMintAttempt> {
        const urls = parseApiList();
        if (!urls.length) {
            return { ok: false, method: 'external_api', reason: 'No MINT_SIGNATURE_API_URLS configured' };
        }

        for (const template of urls) {
            const url = applyTemplate(template, ctx);
            try {
                const isPost = template.includes('{body}') || process.env.MINT_SIGNATURE_API_METHOD === 'POST';
                const res = await fetch(url, {
                    method: isPost ? 'POST' : 'GET',
                    headers: { accept: 'application/json' },
                    signal: AbortSignal.timeout(12_000),
                });
                if (!res.ok) continue;
                const json = (await res.json()) as {
                    to?: string;
                    data?: string;
                    calldata?: string;
                    value?: string;
                };
                const data = json.data || json.calldata;
                const to = json.to;
                if (!to || !data) continue;
                let value = json.value || ctx.whaleTxValue || '0x0';
                if (!value.startsWith('0x')) value = '0x' + BigInt(value).toString(16);
                return {
                    ok: true,
                    method: 'external_api',
                    reason: `External mint API: ${url.slice(0, 60)}`,
                    plan: {
                        tokenContract: ctx.detected.tokenContract,
                        executionTarget: to.toLowerCase(),
                        calldata: data,
                        value,
                        functionName: 'external_api_mint',
                        selector: data.slice(0, 10).toLowerCase(),
                        mintType: BigInt(value) > 0n ? 'paid' : 'free',
                        category: 'CONDITIONAL',
                        confidence: 'medium',
                    },
                };
            } catch {
                continue;
            }
        }
        return { ok: false, method: 'external_api', reason: 'All external mint APIs failed or returned no calldata' };
    },
};