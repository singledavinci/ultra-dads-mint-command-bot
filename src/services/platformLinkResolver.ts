/**
 * Resolve NFT platform URLs (Zora, Manifold) to contract + chain without OpenSea/Reservoir.
 * Phase 3: Ethereum mainnet contracts only.
 */

import { isEthereumChainSlug } from '../config/chains';
import { extractThirdwebContractFromUrl } from './thirdwebResolver';
import { extractZoraCollectContractFromUrl } from './zoraResolver';

export interface PlatformContractTarget {
    contract: string;
    chainSlug: string;
    platform: 'zora' | 'manifold' | 'thirdweb';
    label: string;
}

/** @deprecated Prefer extractZoraCollectContractFromUrl — kept for inline 0x in non-collect paths */
const ZORA_COLLECT_REGEX =
    /zora\.co\/collect\/(?:(ethereum|eth|base|zora|optimism|arbitrum|polygon)[:\/])?(0x[a-fA-F0-9]{40})/i;
const MANIFOLD_CONTRACT_REGEX = /manifold\.xyz\/[^\s]*?(0x[a-fA-F0-9]{40})/i;
const THIRDWEB_CONTRACT_REGEX = /thirdweb\.com\/[^\s]*?(0x[a-fA-F0-9]{40})/i;

function zoraChainToSlug(chain?: string): string {
    const c = (chain || 'ethereum').toLowerCase();
    if (c === 'zora') return 'zora';
    if (c === 'base') return 'base';
    if (c === 'polygon') return 'polygon';
    if (c === 'arbitrum') return 'arbitrum';
    if (c === 'optimism') return 'optimism';
    return 'ethereum';
}

export function resolvePlatformContractFromUrl(input: string): PlatformContractTarget | null {
    const trimmed = input.trim();

    const zoraCollect = extractZoraCollectContractFromUrl(trimmed);
    if (zoraCollect) {
        if (!isEthereumChainSlug(zoraCollect.chainSlug)) return null;
        return {
            contract: zoraCollect.contract,
            chainSlug: 'ethereum',
            platform: 'zora',
            label: `Zora ${zoraCollect.contract.slice(0, 8)}…`,
        };
    }

    const zora = trimmed.match(ZORA_COLLECT_REGEX);
    if (zora) {
        const chainSlug = zoraChainToSlug(zora[1]);
        if (!isEthereumChainSlug(chainSlug)) return null;
        const contract = zora[2].toLowerCase();
        return {
            contract,
            chainSlug: 'ethereum',
            platform: 'zora',
            label: `Zora ${contract.slice(0, 8)}…`,
        };
    }

    const thirdwebPath = extractThirdwebContractFromUrl(trimmed);
    if (thirdwebPath) {
        if (!isEthereumChainSlug(thirdwebPath.chainSlug)) return null;
        return {
            contract: thirdwebPath.contract,
            chainSlug: 'ethereum',
            platform: 'thirdweb',
            label: `Thirdweb ${thirdwebPath.contract.slice(0, 8)}…`,
        };
    }

    const manifold = trimmed.match(MANIFOLD_CONTRACT_REGEX);
    if (manifold) {
        const contract = manifold[1].toLowerCase();
        return {
            contract,
            chainSlug: 'ethereum',
            platform: 'manifold',
            label: `Manifold ${contract.slice(0, 8)}…`,
        };
    }

    const thirdweb = trimmed.match(THIRDWEB_CONTRACT_REGEX);
    if (thirdweb) {
        const contract = thirdweb[1].toLowerCase();
        if (!/thirdweb\.com\/(?:explore\/)?(base|polygon|optimism|arbitrum|zora|avalanche|bnb|linea|scroll|blast)/i.test(trimmed)) {
            return {
                contract,
                chainSlug: 'ethereum',
                platform: 'thirdweb',
                label: `Thirdweb ${contract.slice(0, 8)}…`,
            };
        }
    }

    return null;
}
