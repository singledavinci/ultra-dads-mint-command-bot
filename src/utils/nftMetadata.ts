import { JsonRpcProvider, Contract } from 'ethers';

export interface NFTMetadata {
    name: string;
    symbol: string;
    totalSupply?: string;
    maxSupply?: string;
}

const ERC721_ABI = [
    "function name() view returns (string)",
    "function symbol() view returns (string)",
    "function totalSupply() view returns (uint256)",
    "function maxSupply() view returns (uint256)",
    "function MAX_SUPPLY() view returns (uint256)",
    "function maxTokens() view returns (uint256)",
];

export async function fetchNFTMetadata(address: string, provider: JsonRpcProvider): Promise<NFTMetadata> {
    if (!address || address.trim() === '') {
        return { name: "Contract Deployment", symbol: "Unknown" };
    }

    try {
        const contract = new Contract(address, ERC721_ABI, provider);
        const [name, symbol, totalSupply, maxSupplyRaw, maxSupplyAlt, maxTokens] = await Promise.all([
            contract.name().catch(() => "Unknown"),
            contract.symbol().catch(() => "Unknown"),
            contract.totalSupply().catch(() => undefined),
            contract.maxSupply().catch(() => undefined),
            contract.MAX_SUPPLY().catch(() => undefined),
            contract.maxTokens().catch(() => undefined),
        ]);
        const maxSupply = maxSupplyRaw ?? maxSupplyAlt ?? maxTokens;

        return {
            name,
            symbol,
            totalSupply: totalSupply?.toString(),
            maxSupply: maxSupply?.toString(),
        };
    } catch (error) {
        console.error("Error fetching NFT metadata:", error);
        return { name: "Unknown", symbol: "Unknown" };
    }
}
