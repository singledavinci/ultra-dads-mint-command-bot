import { getAddress, isAddress } from 'ethers';
import type { ContractMintInput } from './types.js';

const ADDR_RE = /0x[a-fA-F0-9]{40}/g;
const TX_RE = /0x[a-fA-F0-9]{64}/g;

export function extractAddresses(text: string): string[] {
    const found = text.match(ADDR_RE) || [];
    return [...new Set(found.map(a => a.toLowerCase()))];
}

export function extractTxHash(text: string): string | undefined {
    const m = text.match(TX_RE);
    return m?.[0]?.toLowerCase();
}

export function normalizeContractMintInput(raw: ContractMintInput): ContractMintInput {
    const chainId = raw.chainId ?? parseInt(process.env.CHAIN_ID || '1', 10);
    let contractAddress = raw.contractAddress?.toLowerCase();
    let txHash = raw.txHash?.toLowerCase();
    let whaleAddress = raw.whaleAddress?.toLowerCase();

    if (raw.rawText) {
        const text = raw.rawText;
        if (!txHash) txHash = extractTxHash(text);
        const addrs = extractAddresses(text);
        if (!contractAddress && addrs.length) {
            contractAddress = addrs.find(a => a !== whaleAddress) || addrs[0];
        }
        if (!whaleAddress && addrs.length >= 2) {
            whaleAddress = addrs[0];
        }
    }

    if (contractAddress && isAddress(contractAddress)) {
        contractAddress = getAddress(contractAddress).toLowerCase();
    }
    if (whaleAddress && isAddress(whaleAddress)) {
        whaleAddress = getAddress(whaleAddress).toLowerCase();
    }

    return {
        ...raw,
        chainId,
        contractAddress,
        txHash,
        whaleAddress,
        quantity: raw.quantity ?? parseInt(process.env.DEFAULT_MINT_QUANTITY || '1', 10),
    };
}

export function parseEtherscanOrOpenseaUrl(text: string): { contract?: string; tx?: string } {
    const tx = extractTxHash(text);
    const contractMatch =
        text.match(/etherscan\.io\/(?:address|token)\/(0x[a-fA-F0-9]{40})/i) ||
        text.match(/opensea\.io\/assets\/[^/]+\/(0x[a-fA-F0-9]{40})/i) ||
        text.match(/blur\.io\/collection\/(0x[a-fA-F0-9]{40})/i);
    return {
        contract: contractMatch?.[1]?.toLowerCase(),
        tx,
    };
}
