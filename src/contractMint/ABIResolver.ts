import { Contract, Interface, JsonRpcProvider } from 'ethers';
import { getContractMintConfig } from './config.js';

const abiCache = new Map<string, { iface: Interface; verified: boolean; at: number }>();
const CACHE_TTL = 3600_000;

const COMMON_MINT_FRAGMENTS = [
    'function mint(uint256 quantity)',
    'function mint()',
    'function mint(address to)',
    'function mint(address to, uint256 quantity)',
    'function mint(uint256 quantity, bytes32[] proof)',
    'function publicMint(uint256 quantity)',
    'function publicSaleMint(uint256 quantity)',
    'function mintPublic(uint256 quantity)',
    'function purchase(uint256 quantity)',
    'function buy(uint256 quantity)',
    'function claim(uint256 quantity)',
    'function freeMint()',
    'function allowlistMint(uint256 quantity, bytes32[] proof)',
    'function mintSigned(uint256 quantity, bytes signature)',
    'function price() view returns (uint256)',
    'function mintPrice() view returns (uint256)',
    'function publicPrice() view returns (uint256)',
    'function cost() view returns (uint256)',
    'function getPrice() view returns (uint256)',
    'function salePrice() view returns (uint256)',
    'function mintFee() view returns (uint256)',
    'function getMintPrice() view returns (uint256)',
];

const PRICE_GETTERS = [
    'function price() view returns (uint256)',
    'function mintPrice() view returns (uint256)',
    'function publicPrice() view returns (uint256)',
    'function cost() view returns (uint256)',
    'function getPrice() view returns (uint256)',
    'function salePrice() view returns (uint256)',
    'function mintFee() view returns (uint256)',
    'function getMintPrice() view returns (uint256)',
];

export interface ResolvedAbi {
    address: string;
    iface: Interface;
    verified: boolean;
    source: 'etherscan' | 'common_registry' | 'bytecode_selector';
}

async function fetchEtherscanAbi(address: string, chainId: number): Promise<string | null> {
    const key = getContractMintConfig().etherscanApiKey;
    if (!key) return null;
    const base =
        chainId === 1
            ? 'https://api.etherscan.io/api'
            : `https://api.etherscan.io/v2/api?chainid=${chainId}`;
    const url = `${base}${chainId === 1 ? '' : '&'}module=contract&action=getabi&address=${address}&apikey=${key}`;
    try {
        const res = await fetch(url);
        const json = (await res.json()) as { status: string; result: string };
        if (json.status !== '1' || !json.result || json.result.includes('not verified')) return null;
        return json.result;
    } catch {
        return null;
    }
}

export async function resolveAbi(
    address: string,
    provider: JsonRpcProvider,
    chainId = 1
): Promise<ResolvedAbi> {
    const key = address.toLowerCase();
    const cached = abiCache.get(key);
    if (cached && Date.now() - cached.at < CACHE_TTL) {
        return { address: key, iface: cached.iface, verified: cached.verified, source: 'common_registry' };
    }

    let iface: Interface;
    let verified = false;
    let source: ResolvedAbi['source'] = 'common_registry';

    const etherscanJson = await fetchEtherscanAbi(key, chainId);
    if (etherscanJson) {
        iface = new Interface(etherscanJson);
        verified = true;
        source = 'etherscan';
    } else {
        iface = new Interface(COMMON_MINT_FRAGMENTS);
        try {
            const code = await provider.getCode(key);
            if (!code || code === '0x') {
                iface = new Interface(COMMON_MINT_FRAGMENTS);
            }
        } catch {
            /* use common */
        }
    }

    abiCache.set(key, { iface, verified, at: Date.now() });
    return { address: key, iface, verified, source };
}

export async function readOnChainPrice(
    contractAddress: string,
    provider: JsonRpcProvider
): Promise<{ price: bigint; source: string } | null> {
    const c = new Contract(contractAddress, PRICE_GETTERS, provider);
    const names = ['price', 'mintPrice', 'publicPrice', 'cost', 'getPrice', 'salePrice', 'mintFee', 'getMintPrice'];
    for (const n of names) {
        try {
            const v = await c[n]();
            const price = BigInt(v.toString());
            if (price >= 0n) return { price, source: n };
        } catch {
            /* next */
        }
    }
    return null;
}

export function getCommonMintInterface(): Interface {
    return new Interface(COMMON_MINT_FRAGMENTS);
}
