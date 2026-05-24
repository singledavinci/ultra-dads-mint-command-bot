import type { TypedDataDomain, TypedDataField } from 'ethers';

export interface CollectionData {
    address: string;
    targetFloor: string; // in ETH
}

type ReservoirCollectionsResponse = {
    collections?: Array<{ floorAsk?: { price?: { amount?: { native?: number } } } }>;
};

type ReservoirTokensResponse = {
    tokens?: Array<{ token: { tokenId: string } }>;
};

type ReservoirListResponse = {
    steps?: Array<{
        id?: string;
        items?: Array<{ data: { sign: { domain: unknown; types: Record<string, unknown>; value: unknown }; post: { query: unknown; body: unknown } } }>;
    }>;
};

type ReservoirSellResponse = {
    steps?: Array<{
        kind?: string;
        items?: Array<{ data?: { sign?: { domain: unknown; types: Record<string, unknown>; value: unknown }; post?: { endpoint?: string } } }>;
    }>;
};

type ReservoirUserTokensResponse = {
    tokens?: Array<{ token?: { tokenId?: string; contract?: string; topBid?: { price?: { amount?: { native?: number } } } } }>;
};

export async function checkProfitTarget(collections: CollectionData[]): Promise<{ c: CollectionData, currentFloor: number }[]> {
    const hits: { c: CollectionData, currentFloor: number }[] = [];

    for (const c of collections) {
        try {
            const url = `https://api.reservoir.tools/collections/v5?contract=${c.address}`;
            const res = await fetch(url);
            const data = (await res.json()) as ReservoirCollectionsResponse;

            if (data.collections && data.collections.length > 0) {
                const floorAsk = data.collections[0].floorAsk?.price?.amount?.native;
                if (floorAsk !== undefined && floorAsk >= parseFloat(c.targetFloor)) {
                    hits.push({ c, currentFloor: floorAsk });
                }
            }
        } catch (e) {
            console.error(`Error fetching floor for ${c.address}:`, e);
        }

        // Rate limit protection for Reservoir public endpoints
        await new Promise(resolve => setTimeout(resolve, 1000));
    }


    return hits;
}

export async function autoListTokens(privateKeys: string[], contractAddress: string, listPriceEth: number, providerUrl: string) {
    const { ethers, JsonRpcProvider } = await import('ethers');
    const provider = new JsonRpcProvider(providerUrl);

    const results: { wallet: string, tokenId: unknown, price: number, status: string }[] = [];
    const listPriceWei = ethers.parseEther(listPriceEth.toString()).toString();

    for (const pk of privateKeys) {
        try {
            const wallet = new ethers.Wallet(pk, provider);

            // 1. Fetch user tokens via Reservoir
            const userTokensUrl = `https://api.reservoir.tools/users/${wallet.address}/tokens/v7?collection=${contractAddress}`;
            const tokensRes = await fetch(userTokensUrl);
            const tokensData = (await tokensRes.json()) as ReservoirTokensResponse;

            if (!tokensData.tokens || tokensData.tokens.length === 0) continue;

            for (const t of tokensData.tokens) {
                const tokenId = t.token.tokenId;

                // 2. Fetch Listing Payload (EIP-712) for OpenSea
                const params = new URLSearchParams({
                    maker: wallet.address,
                    source: 'opensea.io',
                });
                // Format: token=contract:tokenId
                params.append('params[0][token]', `${contractAddress}:${tokenId}`);
                params.append('params[0][weiPrice]', listPriceWei);
                params.append('params[0][orderbook]', 'opensea');

                const executeUrl = `https://api.reservoir.tools/execute/list/v5`;
                const listRes = await fetch(executeUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        maker: wallet.address,
                        source: 'opensea.io',
                        params: [{
                            token: `${contractAddress}:${tokenId}`,
                            weiPrice: listPriceWei,
                            orderbook: 'opensea',
                            orderKind: 'seaport-v1.5'
                        }]
                    })
                });

                const listData = (await listRes.json()) as ReservoirListResponse;

                // 3. Sign the EIP-712 Payload
                if (listData.steps) {
                    const signatureStep = listData.steps.find((s: Record<string, unknown>) => s.id === 'order-signature');
                    if (signatureStep && signatureStep.items && signatureStep.items.length > 0) {
                        const item = signatureStep.items[0];
                        const { domain, types, value } = item.data.sign;

                        // Remove injected typed data props Ethers doesn't want
                        delete types.EIP712Domain;

                        const signature = await wallet.signTypedData(
                            domain as TypedDataDomain,
                            types as Record<string, TypedDataField[]>,
                            value as Record<string, any>
                        );

                        // 4. Submit Signature back to Reservoir
                        const submitUrl = `https://api.reservoir.tools/execute/list/v5/signature`;
                        await fetch(submitUrl, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                signature,
                                query: item.data.post.query,
                                body: item.data.post.body
                            })
                        });

                        results.push({ wallet: wallet.address, tokenId, price: listPriceEth, status: 'Listed on OpenSea' });
                    }
                }
            }
        } catch (err) {
            const e = err as Error;
            console.error(`Listing failed for wallet ${pk.slice(0, 10)}... :`, e.message);
        }
    }

    return results;
}

export interface AcceptOfferResult {
    wallet: string;
    tokenId: string;
    priceEth: number;
    status: string;
}

/**
 * Scan wallets for active bids on owned tokens and fulfill via Reservoir Seaport sell flow.
 * MVP: best-effort; skips tokens without a qualifying top bid.
 */
export async function autoAcceptOffers(
    privateKeys: string[],
    options: {
        contractAddress?: string;
        minOfferEth?: number;
        providerUrl: string;
    }
): Promise<AcceptOfferResult[]> {
    const { ethers, JsonRpcProvider } = await import('ethers');
    const provider = new JsonRpcProvider(options.providerUrl);
    const minEth = options.minOfferEth ?? 0;
    const results: AcceptOfferResult[] = [];

    for (const pk of privateKeys) {
        try {
            const wallet = new ethers.Wallet(pk, provider);
            let tokensUrl = `https://api.reservoir.tools/users/${wallet.address}/tokens/v10?limit=50&includeTopBid=true`;
            if (options.contractAddress) {
                tokensUrl += `&collection=${options.contractAddress}`;
            }

            const tokensRes = await fetch(tokensUrl);
            const tokensData = (await tokensRes.json()) as ReservoirUserTokensResponse;
            const tokens = tokensData.tokens || [];

            for (const t of tokens) {
                const tokenId = t.token?.tokenId;
                const contract = t.token?.contract || options.contractAddress;
                const topBid = t.token?.topBid?.price?.amount?.native;
                if (!tokenId || !contract || topBid === undefined || topBid < minEth) continue;

                try {
                    const executeUrl = 'https://api.reservoir.tools/execute/sell/v7';
                    const sellRes = await fetch(executeUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            maker: wallet.address,
                            source: 'opensea.io',
                            params: [{
                                token: `${contract}:${tokenId}`,
                                orderKind: 'seaport-v1.5',
                                orderbook: 'opensea',
                                quantity: 1,
                            }],
                        }),
                    });
                    const sellData = (await sellRes.json()) as ReservoirSellResponse;

                    if (!sellData.steps) {
                        results.push({
                            wallet: wallet.address,
                            tokenId: String(tokenId),
                            priceEth: topBid,
                            status: 'no_fulfill_steps',
                        });
                        continue;
                    }

                    let fulfilled = false;
                    for (const step of sellData.steps) {
                        if (step.kind !== 'signature' || !step.items?.length) continue;
                        for (const item of step.items) {
                            const itemData = item.data;
                            const signData = itemData?.sign;
                            if (!signData) continue;
                            const { domain, types, value } = signData;
                            const typesCopy = { ...types };
                            delete typesCopy.EIP712Domain;
                            const signature = await wallet.signTypedData(
                                domain as TypedDataDomain,
                                typesCopy as Record<string, TypedDataField[]>,
                                value as Record<string, any>
                            );

                            const post = itemData?.post;
                            const submitUrl = post?.endpoint
                                ? `https://api.reservoir.tools${post.endpoint}`
                                : 'https://api.reservoir.tools/execute/sell/v7/signature';
                            await fetch(submitUrl, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    signature,
                                    post,
                                }),
                            });
                            fulfilled = true;
                        }
                    }

                    results.push({
                        wallet: wallet.address,
                        tokenId: String(tokenId),
                        priceEth: topBid,
                        status: fulfilled ? 'offer_accepted' : 'signature_pending',
                    });
                } catch (innerErr) {
                    const e = innerErr as Error;
                    results.push({
                        wallet: wallet.address,
                        tokenId: String(tokenId),
                        priceEth: topBid,
                        status: `failed: ${e.message?.slice(0, 40)}`,
                    });
                }

                await new Promise(resolve => setTimeout(resolve, 500));
            }
        } catch (err) {
            const e = err as Error;
            console.error(`[autoAcceptOffers] wallet ${pk.slice(0, 10)}...:`, e.message);
        }
    }

    return results;
}
