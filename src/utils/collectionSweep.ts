import { ethers } from 'ethers';
import { extractAlchemyApiKey } from '../services/mintedNftReport';

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const ERC721_ABI = [
    'function safeTransferFrom(address from, address to, uint256 tokenId)',
    'function transferFrom(address from, address to, uint256 tokenId)',
    'function ownerOf(uint256 tokenId) view returns (address)',
    'function balanceOf(address owner) view returns (uint256)',
    'function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)',
];

export interface SweepWallet {
    address: string;
    privateKey: string;
}

export interface CollectionSweepResult {
    sweptCount: number;
    scannedWallets: number;
    tokenIdsFound: number;
    errors: string[];
    /** How tokens were discovered (for debugging / user feedback) */
    discoveryMethod: string;
    txHashes: string[];
}

export function parseNftTokenId(raw: string): bigint {
    const t = raw.trim();
    if (t.startsWith('0x')) return BigInt(t);
    return BigInt(t);
}

function resolveAlchemyApiKey(rpcUrl?: string): string | null {
    return (
        extractAlchemyApiKey(process.env.ALCHEMY_API_KEY) ||
        extractAlchemyApiKey(rpcUrl) ||
        extractAlchemyApiKey(process.env.PROVIDER_URL) ||
        null
    );
}

/** Alchemy NFT API v3 — works even when primary RPC is QuickNode. */
async function discoverViaAlchemyNftApi(
    apiKey: string,
    walletAddress: string,
    contractAddress: string
): Promise<bigint[]> {
    try {
        const params = new URLSearchParams({
            owner: walletAddress,
            withMetadata: 'false',
        });
        params.append('contractAddresses[]', contractAddress);
        const url = `https://eth-mainnet.g.alchemy.com/nft/v3/${apiKey}/getNFTsForOwner?${params}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
        if (!res.ok) {
            console.warn(`[Sweep] Alchemy NFT API HTTP ${res.status} for ${walletAddress.slice(0, 8)}`);
            return [];
        }
        const data = (await res.json()) as {
            ownedNfts?: Array<{ tokenId?: string; id?: { tokenId?: string } }>;
        };
        const ids: bigint[] = [];
        for (const n of data.ownedNfts || []) {
            const raw = n.tokenId ?? n.id?.tokenId;
            if (!raw) continue;
            try {
                ids.push(parseNftTokenId(raw));
            } catch {
                /* skip bad id */
            }
        }
        return ids;
    } catch (e: unknown) {
        console.warn(`[Sweep] Alchemy discovery failed ${walletAddress.slice(0, 8)}:`, (e as Error).message?.slice(0, 80));
        return [];
    }
}

/** On-chain ERC721Enumerable balanceOf + tokenOfOwnerByIndex. */
async function discoverViaEnumerable(
    provider: ethers.Provider,
    walletAddress: string,
    contractAddress: string
): Promise<bigint[]> {
    try {
        const contract = new ethers.Contract(contractAddress, ERC721_ABI, provider);
        const bal: bigint = await contract.balanceOf(walletAddress);
        const n = Number(bal);
        if (!Number.isFinite(n) || n <= 0 || n > 500) return [];
        const ids: bigint[] = [];
        for (let i = 0; i < n; i++) {
            const tid: bigint = await contract.tokenOfOwnerByIndex(walletAddress, i);
            ids.push(tid);
        }
        return ids;
    } catch {
        return [];
    }
}

/** Log-scan fallback — last N blocks of Transfer events to wallet. */
async function discoverViaLogs(
    provider: ethers.Provider,
    walletAddress: string,
    contractAddress: string,
    currentBlock: number,
    lookback = 500_000
): Promise<bigint[]> {
    const owned = new Set<string>();
    const fromBlock = Math.max(0, currentBlock - lookback);
    let chunkSize = 2000;
    let b = fromBlock;
    const walletTopic = ethers.zeroPadValue(walletAddress, 32);

    while (b <= currentBlock) {
        const endBlock = Math.min(b + chunkSize - 1, currentBlock);
        try {
            const chunkLogs = await provider.getLogs({
                address: contractAddress,
                fromBlock: b,
                toBlock: endBlock,
                topics: [TRANSFER_TOPIC, null, walletTopic],
            });
            for (const l of chunkLogs) {
                if (l.topics[3]) owned.add(l.topics[3].toLowerCase());
            }
            b = endBlock + 1;
        } catch (e: unknown) {
            const errStr = (e as Error).message || String(e);
            if (chunkSize > 10) {
                chunkSize = errStr.includes('10 block') || errStr.includes('-32600') ? 10 : Math.max(10, Math.floor(chunkSize / 4));
            } else {
                b += 10;
            }
        }
    }

    const ids: bigint[] = [];
    for (const topic of owned) {
        try {
            ids.push(BigInt(topic));
        } catch {
            /* skip */
        }
    }
    return ids;
}

async function discoverWalletTokens(
    provider: ethers.Provider,
    walletAddress: string,
    contractAddress: string,
    currentBlock: number,
    apiKey: string | null
): Promise<{ ids: bigint[]; method: string }> {
    if (apiKey) {
        const fromAlchemy = await discoverViaAlchemyNftApi(apiKey, walletAddress, contractAddress);
        if (fromAlchemy.length > 0) {
            return { ids: fromAlchemy, method: 'alchemy' };
        }
    }

    const fromEnum = await discoverViaEnumerable(provider, walletAddress, contractAddress);
    if (fromEnum.length > 0) {
        return { ids: fromEnum, method: 'enumerable' };
    }

    const fromLogs = await discoverViaLogs(provider, walletAddress, contractAddress, currentBlock);
    if (fromLogs.length > 0) {
        return { ids: fromLogs, method: 'logs' };
    }

    return { ids: [], method: apiKey ? 'none' : 'none_no_alchemy' };
}

async function transferNft(
    contract: ethers.Contract,
    from: string,
    to: string,
    tokenId: bigint
): Promise<string> {
    try {
        const tx = await contract.safeTransferFrom(from, to, tokenId);
        const rec = await tx.wait();
        return rec?.hash || tx.hash;
    } catch (e1: unknown) {
        const msg1 = (e1 as Error).message || '';
        if (!msg1.toLowerCase().includes('safetransfer') && !msg1.includes('ERC721')) {
            throw e1;
        }
        const tx = await contract.transferFrom(from, to, tokenId);
        const rec = await tx.wait();
        return rec?.hash || tx.hash;
    }
}

/**
 * Sweep NFTs from a single collection across sub-wallets into one destination.
 */
export async function sweepCollectionNfts(
    provider: ethers.Provider,
    wallets: SweepWallet[],
    contractAddress: string,
    destination: string,
    providedTokenIds?: bigint[],
    rpcUrl?: string
): Promise<CollectionSweepResult> {
    const result: CollectionSweepResult = {
        sweptCount: 0,
        scannedWallets: wallets.length,
        tokenIdsFound: 0,
        errors: [],
        discoveryMethod: '',
        txHashes: [],
    };

    const normalizedContract = ethers.getAddress(contractAddress);
    const dest = ethers.getAddress(destination);
    const apiKey = resolveAlchemyApiKey(rpcUrl);
    const methodsUsed = new Set<string>();

    console.log(
        `[Sweep] start contract=${normalizedContract.slice(0, 10)} wallets=${wallets.length} alchemy=${apiKey ? 'yes' : 'no'}`
    );

    const currentBlock = await provider.getBlockNumber();
    const tokenMap = new Map<string, bigint[]>();

    if (providedTokenIds && providedTokenIds.length > 0) {
        for (const w of wallets) {
            tokenMap.set(w.address.toLowerCase(), [...providedTokenIds]);
        }
        methodsUsed.add('manual_ids');
    } else {
        for (const w of wallets) {
            const { ids, method } = await discoverWalletTokens(
                provider,
                w.address,
                normalizedContract,
                currentBlock,
                apiKey
            );
            methodsUsed.add(method);
            if (ids.length) tokenMap.set(w.address.toLowerCase(), ids);
            console.log(`[Sweep] discover ${w.address.slice(0, 8)} method=${method} count=${ids.length}`);
        }
    }

    result.discoveryMethod = [...methodsUsed].join(',') || 'none';
    const destLower = dest.toLowerCase();

    for (const w of wallets) {
        if (w.address.toLowerCase() === destLower) continue;

        const tokenIds = tokenMap.get(w.address.toLowerCase()) || [];
        result.tokenIdsFound += tokenIds.length;
        if (tokenIds.length === 0) continue;

        const wallet = new ethers.Wallet(w.privateKey, provider);
        const contract = new ethers.Contract(normalizedContract, ERC721_ABI, wallet);

        for (const tid of tokenIds) {
            try {
                const owner = await contract.ownerOf(tid);
                if (owner.toLowerCase() !== w.address.toLowerCase()) {
                    result.errors.push(`${w.address.slice(0, 8)}:#${tid}: not owner (${owner.slice(0, 8)})`);
                    continue;
                }
                const txHash = await transferNft(contract, w.address, dest, tid);
                result.sweptCount++;
                result.txHashes.push(txHash);
                console.log(`[Sweep] transferred #${tid} ${w.address.slice(0, 8)} → ${dest.slice(0, 8)} tx=${txHash.slice(0, 14)}`);
            } catch (e: unknown) {
                const errMsg = (e as Error).message?.slice(0, 80) || 'transfer failed';
                result.errors.push(`${w.address.slice(0, 8)}:#${tid}: ${errMsg}`);
                console.warn(`[Sweep] transfer fail #${tid} ${w.address.slice(0, 8)}: ${errMsg}`);
            }
        }
    }

    console.log(
        `[Sweep] done found=${result.tokenIdsFound} swept=${result.sweptCount} errors=${result.errors.length} methods=${result.discoveryMethod}`
    );

    return result;
}
