import { classifyMintTransaction } from '../services/mintClassifier';
import { getRuntimeConfig } from '../config/runtimeConfig';
import type { DetectedMintCandidate, MintClassification, MintType } from '../types/copyMint';

const selectorCache = new Map<string, MintClassification>();

function mapMintType(selectorName?: string, selector?: string): MintType {
    const n = (selectorName || '').toLowerCase();
    if (n.includes('scatter')) return 'custom';
    if (n.includes('seadrop') || selector === '0x000000000') return 'seadrop';
    if (n.includes('erc721a')) return 'erc721a';
    if (n.includes('manifold')) return 'manifold';
    if (n.includes('zora')) return 'zora';
    if (n.includes('thirdweb')) return 'thirdweb';
    if (n.includes('mint') || n.includes('public')) return 'erc721_direct';
    if (selector && selector !== '0x') return 'custom';
    return 'unknown';
}

export class EngineMintClassifier {
    static classify(candidate: DetectedMintCandidate): MintClassification {
        const cfg = getRuntimeConfig();
        const cacheKey = `${candidate.to.toLowerCase()}:${candidate.data.slice(0, 10)}`;
        const cached = selectorCache.get(cacheKey);
        if (cached) return { ...cached };

        if (candidate.data === '0x' || !candidate.data || candidate.data.length < 10) {
            return {
                isLikelyMint: false,
                confidence: 'high',
                mintType: 'rejected',
                methodSelector: '0x',
                calldataNeedsWalletRewrite: false,
                rejectionReason: 'empty_calldata',
                warnings: [],
            };
        }

        const result = classifyMintTransaction(
            candidate.data,
            candidate.value,
            candidate.to,
            cfg.copyUnknownMintCalls
        );

        const mintType = result.isMint
            ? mapMintType(result.selectorName, result.selector)
            : 'rejected';

        let isLikelyMint = result.isMint;
        let rejectionReason = result.reason;

        if (cfg.requireKnownSelector && result.confidence === 'low' && !cfg.copyUnknownMintCalls) {
            isLikelyMint = false;
            rejectionReason = rejectionReason || 'unknown_selector';
        }

        const classification: MintClassification = {
            isLikelyMint,
            confidence: result.confidence,
            mintType: isLikelyMint ? mintType : 'rejected',
            methodSelector: result.selector,
            methodName: result.selectorName,
            calldataNeedsWalletRewrite:
                mintType === 'seadrop' ||
                candidate.data.toLowerCase().includes((candidate.sourceWallet || '').toLowerCase().replace('0x', '').padStart(64, '0')),
            rejectionReason: isLikelyMint ? undefined : rejectionReason,
            warnings: [],
        };

        selectorCache.set(cacheKey, classification);
        return classification;
    }
}
