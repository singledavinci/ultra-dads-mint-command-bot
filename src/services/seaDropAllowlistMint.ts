/**
 * SeaDrop GTD / allowlist mints without relying on OpenSea POST /mint.
 *
 * Flow:
 *   1. Read on-chain allowlist merkle root (SeaDrop router)
 *   2. Load allowlist JSON from chain event URI, OpenSea drop metadata, or env override
 *   3. Build merkle proof + mintAllowList calldata for the minter wallet
 */

import {
    AbiCoder,
    Contract,
    Interface,
    JsonRpcProvider,
    id,
    keccak256,
    zeroPadValue,
} from 'ethers';
import { resolveOpenSeaSlugFromContract } from '../contractMint/signatureMint/slugResolver.js';
import { merkleProofForLeaf, merkleRootFromLeaves } from '../utils/merkleTree.js';
import {
    findSeaDropPublicDrop,
    SEADROP_ROUTERS,
    resolveSeaDropFeeRecipient,
    seaDropMinterIfNotPayerForSelfMint,
    type SeaDropMintResult,
} from './seaDropBuilder.js';

const SEADROP_ALLOWLIST_ABI = [
    'function getAllowListMerkleRoot(address nftContract) view returns (bytes32)',
    'event AllowListUpdated(address indexed nftContract, bytes32 merkleRoot, string[] publicKeyURIs, string allowListURI)',
];

const MINT_ALLOWLIST_IFACE = new Interface([
    'function mintAllowList(address nftContract, address feeRecipient, address minterIfNotPayer, uint256 quantity, (uint256 mintPrice, uint256 maxTotalMintableByWallet, uint256 startTime, uint256 endTime, uint256 dropStageIndex, uint256 maxTokenSupplyForStage, uint256 feeBps, bool restrictFeeRecipients) mintParams, bytes32[] proof)',
]);

export const SEADROP_MINT_ALLOWLIST_V2 = id(
    'mintAllowList(address,address,address,uint256,(uint256,uint256,uint256,uint256,uint256,uint256,uint256,bool),bytes32[])'
).slice(0, 10);

export type SeaDropMintParamsTuple = [
    bigint,
    bigint,
    bigint,
    bigint,
    bigint,
    bigint,
    bigint,
    boolean,
];

export function seaDropAllowlistLeafHash(minter: string, mintParams: SeaDropMintParamsTuple): string {
    return keccak256(
        AbiCoder.defaultAbiCoder().encode(
            [
                'address',
                'tuple(uint256,uint256,uint256,uint256,uint256,uint256,uint256,bool)',
            ],
            [minter, mintParams]
        )
    );
}

export async function readAllowListMerkleRoot(
    nftContract: string,
    provider: JsonRpcProvider
): Promise<{ root: string; router: string } | null> {
    for (const router of SEADROP_ROUTERS) {
        try {
            const c = new Contract(router, SEADROP_ALLOWLIST_ABI, provider);
            const root = await c.getAllowListMerkleRoot(nftContract);
            const hex = String(root);
            if (hex && hex !== '0x' + '0'.repeat(64)) {
                return { root: hex.toLowerCase(), router };
            }
        } catch {
            /* try next router */
        }
    }
    return null;
}

export async function fetchAllowListUriFromChain(
    nftContract: string,
    provider: JsonRpcProvider,
    fromBlock?: number
): Promise<string | null> {
    const iface = new Interface(SEADROP_ALLOWLIST_ABI);
    const topic0 = iface.getEvent('AllowListUpdated')!.topicHash;
    const topic1 = zeroPadValue(nftContract, 32);
    const latest = await provider.getBlockNumber();
    const span = parseInt(process.env.SEADROP_ALLOWLIST_LOG_LOOKBACK || '2500000', 10);
    const from = fromBlock ?? Math.max(0, latest - span);

    for (const router of SEADROP_ROUTERS) {
        try {
            const logs = await provider.getLogs({
                address: router,
                topics: [topic0, topic1],
                fromBlock: from,
                toBlock: latest,
            });
            if (logs.length === 0) continue;
            const last = logs[logs.length - 1];
            const parsed = iface.parseLog(last);
            const uri = parsed?.args?.allowListURI as string | undefined;
            if (uri?.trim()) return uri.trim();
        } catch {
            /* next router */
        }
    }
    return null;
}

type AllowlistPayload =
    | string[]
    | { addresses?: string[]; allowlist?: string[] }
    | { entries?: Array<{ address?: string; wallet?: string; proof?: string[] }> }
    | { proofs?: Record<string, string[]> };

export function parseAllowlistAddresses(payload: unknown): string[] {
    if (Array.isArray(payload)) {
        return payload.filter((a): a is string => typeof a === 'string' && a.startsWith('0x'));
    }
    if (!payload || typeof payload !== 'object') return [];
    const p = payload as AllowlistPayload;
    if (Array.isArray(p)) return [];
    if ('addresses' in p && Array.isArray(p.addresses)) return p.addresses;
    if ('allowlist' in p && Array.isArray(p.allowlist)) return p.allowlist;
    if ('entries' in p && Array.isArray(p.entries)) {
        return p.entries
            .map(e => e.address || e.wallet)
            .filter((a): a is string => typeof a === 'string' && a.startsWith('0x'));
    }
    return [];
}

export function precomputedProofFromPayload(
    payload: unknown,
    minter: string
): string[] | null {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
    const p = payload as AllowlistPayload;
    const key = minter.toLowerCase();

    if ('proofs' in p && p.proofs && typeof p.proofs === 'object') {
        const hit = p.proofs[key] || p.proofs[minter];
        if (Array.isArray(hit) && hit.length > 0) return hit;
    }
    if ('entries' in p && Array.isArray(p.entries)) {
        const row = p.entries.find(
            e => (e.address || e.wallet || '').toLowerCase() === key
        );
        if (row?.proof?.length) return row.proof;
    }
    return null;
}

export async function fetchAllowlistJson(uri: string): Promise<unknown | null> {
    const url = uri.startsWith('ipfs://')
        ? `https://ipfs.io/ipfs/${uri.slice(7)}`
        : uri;
    try {
        const res = await fetch(url, {
            headers: { accept: 'application/json' },
            signal: AbortSignal.timeout(20_000),
        });
        if (!res.ok) return null;
        return await res.json();
    } catch {
        return null;
    }
}

export interface OpenSeaAllowlistStage {
    mintParams: SeaDropMintParamsTuple;
    label: string;
}

/** Map OpenSea drop stages → SeaDrop MintParams for allowlist/GTD phases. */
export async function fetchOpenSeaAllowlistStage(
    slug: string
): Promise<OpenSeaAllowlistStage | null> {
    const headers: Record<string, string> = { accept: 'application/json' };
    const apiKey = process.env.OPENSEA_API_KEY?.trim();
    if (apiKey) headers['x-api-key'] = apiKey;

    try {
        const res = await fetch(`https://api.opensea.io/api/v2/drops/${encodeURIComponent(slug)}`, {
            headers,
            signal: AbortSignal.timeout(12_000),
        });
        if (!res.ok) return null;
        const json = (await res.json()) as {
            stages?: Array<{
                stage_type?: string;
                label?: string;
                price?: string;
                start_time?: string;
                end_time?: string;
                max_per_wallet?: string;
            }>;
        };
        const stages = json.stages || [];
        const stage = stages.find(s => {
            const t = `${s.stage_type || ''} ${s.label || ''}`.toLowerCase();
            return /allow|presale|gtd|whitelist|priority/.test(t);
        });
        if (!stage) return null;

        const start = stage.start_time
            ? Math.floor(new Date(stage.start_time).getTime() / 1000)
            : 0;
        const end = stage.end_time ? Math.floor(new Date(stage.end_time).getTime() / 1000) : 0;
        const maxWallet = parseInt(stage.max_per_wallet || '1', 10) || 1;
        const price = BigInt(stage.price || '0');

        const mintParams: SeaDropMintParamsTuple = [
            price,
            BigInt(maxWallet),
            BigInt(start),
            BigInt(end),
            1n,
            BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'),
            0n,
            false,
        ];

        return { mintParams, label: stage.label || stage.stage_type || 'allowlist' };
    } catch {
        return null;
    }
}

export function buildAllowlistMintCalldata(params: {
    router: string;
    nftContract: string;
    feeRecipient: string;
    minter: string;
    quantity: number;
    mintParams: SeaDropMintParamsTuple;
    proof: string[];
}): SeaDropMintResult {
    const data =
        SEADROP_MINT_ALLOWLIST_V2 +
        AbiCoder.defaultAbiCoder()
            .encode(
                [
                    'address',
                    'address',
                    'address',
                    'uint256',
                    'tuple(uint256,uint256,uint256,uint256,uint256,uint256,uint256,bool)',
                    'bytes32[]',
                ],
                [
                    params.nftContract,
                    params.feeRecipient,
                    seaDropMinterIfNotPayerForSelfMint(),
                    BigInt(params.quantity),
                    params.mintParams,
                    params.proof,
                ]
            )
            .slice(2);

    const value = params.mintParams[0] * BigInt(params.quantity);

    return {
        to: params.router,
        data,
        value: value > 0n ? '0x' + value.toString(16) : '0x0',
        selector: SEADROP_MINT_ALLOWLIST_V2,
        functionName: 'mintAllowList',
        warnings: ['On-chain GTD / allowlist (merkle proof)'],
    };
}

export interface ResolveOnChainAllowlistParams {
    nftContract: string;
    minter: string;
    quantity: number;
    provider: JsonRpcProvider;
    /** Optional allowlist JSON URL (overrides chain URI) */
    allowlistUriOverride?: string;
}

/**
 * Build allowlist mint tx from on-chain root + published allowlist file.
 */
export async function resolveOnChainAllowlistMint(
    params: ResolveOnChainAllowlistParams
): Promise<SeaDropMintResult | null> {
    if (process.env.SEADROP_ONCHAIN_ALLOWLIST === 'false') return null;

    const nft = params.nftContract.toLowerCase();
    const minter = params.minter.toLowerCase();

    const rootInfo = await readAllowListMerkleRoot(nft, params.provider);
    if (!rootInfo) return null;

    let allowlistUri =
        params.allowlistUriOverride?.trim() ||
        process.env[`SEADROP_ALLOWLIST_URI_${nft}`]?.trim() ||
        process.env.SEADROP_ALLOWLIST_URI?.trim() ||
        null;

    if (!allowlistUri) {
        allowlistUri = await fetchAllowListUriFromChain(nft, params.provider);
    }

    if (!allowlistUri) return null;

    const payload = await fetchAllowlistJson(allowlistUri);
    if (!payload) return null;

    const slug = await resolveOpenSeaSlugFromContract(nft, 1);
    let stage = slug ? await fetchOpenSeaAllowlistStage(slug) : null;
    if (!stage) {
        const pub = await findSeaDropPublicDrop(nft, params.provider);
        const now = Math.floor(Date.now() / 1000);
        const end = pub?.isActive ? now + 86400 * 7 : now;
        stage = {
            label: 'allowlist',
            mintParams: [
                pub?.mintPrice ?? 0n,
                BigInt(parseInt(process.env.SEADROP_ALLOWLIST_MAX_PER_WALLET || '2', 10)),
                BigInt(now),
                BigInt(end),
                1n,
                BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'),
                0n,
                false,
            ],
        };
    }

    let proof = precomputedProofFromPayload(payload, minter);
    if (!proof) {
        const addresses = parseAllowlistAddresses(payload).map(a => a.toLowerCase());
        if (!addresses.includes(minter)) return null;

        const leaves = addresses.map(a =>
            seaDropAllowlistLeafHash(a, stage.mintParams).toLowerCase()
        );
        const computedRoot = merkleRootFromLeaves(leaves);
        if (computedRoot && computedRoot !== rootInfo.root.toLowerCase()) {
            return null;
        }
        const leaf = seaDropAllowlistLeafHash(minter, stage.mintParams).toLowerCase();
        proof = merkleProofForLeaf(leaves, leaf);
        if (!proof) return null;
    }

    const feeRecipient = await resolveSeaDropFeeRecipient(
        nft,
        params.provider,
        rootInfo.router,
        false
    );

    const result = buildAllowlistMintCalldata({
        router: rootInfo.router,
        nftContract: nft,
        feeRecipient,
        minter,
        quantity: params.quantity,
        mintParams: stage.mintParams,
        proof,
    });

    result.warnings.push(`GTD stage: <b>${stage.label}</b>`);
    result.warnings.push(`Allowlist root <code>${rootInfo.root.slice(0, 12)}…</code>`);

    try {
        await params.provider.estimateGas({
            to: result.to,
            from: minter,
            data: result.data,
            value: BigInt(result.value || '0'),
        });
    } catch {
        return null;
    }

    return result;
}
