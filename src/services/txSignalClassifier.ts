/**
 * Mint Classifier — determines whether a transaction is likely an NFT mint.
 *
 * Rejects obvious non-mint transactions (ERC20 transfers, approvals, swaps,
 * simple ETH transfers) and identifies known mint selectors from common
 * NFT platforms (ERC721, SeaDrop, Manifold, Zora, thirdweb, etc.).
 *
 * Each function selector appears at most once (duplicate keys in a plain object
 * silently overwrite entries in JS).
 */

import type { MintClassification } from '../types/detection';

export type MintConfidence = MintClassification['confidence'];

const rank: Record<MintConfidence, number> = { high: 3, medium: 2, low: 1 };

/** True if `c` is at least as strong as `min`. */
export function confidenceMeetsMinimum(c: MintConfidence, min: MintConfidence): boolean {
    return rank[c] >= rank[min];
}

/** Build lookup from explicit pairs — last duplicate key in source wins (avoid silent bugs). */
function toSelectorMap(entries: readonly (readonly [string, string])[]): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [sel, name] of entries) {
        out[sel.toLowerCase()] = name;
    }
    return out;
}

// ---- Known MINT selectors (high confidence) — one canonical name per 4-byte selector ----
const KNOWN_MINT_ENTRIES: readonly (readonly [string, string])[] = [
    // Generic mint patterns
    ['0xa0712d68', 'mint(uint256)'],
    ['0x1249c58b', 'mint()'],
    ['0x40c10f19', 'mint(address,uint256)'],
    ['0x6a627842', 'mint(address)'],
    ['0xa14481e9', 'mint(address,uint256)'],
    ['0xefef39a1', 'mint(uint256,bytes32[])'],
    ['0x2db11544', 'mint(uint256)'],
    ['0xf3b2dc9d', 'mint(uint256)'],
    ['0x33b66418', 'mint(uint256)'],

    // SeaDrop
    ['0x161ac21f', 'mintPublic(address,address,address,uint256)'],
    ['0x51061988', 'mintPublic(address,address,address,uint256) [legacy v1.1]'],
    ['0x46332f08', 'mintAllowlist(address,address,address,uint256,bytes32[])'],

    // Manifold
    ['0xfa2b068f', 'mint(address,uint256,uint256,address[],uint256[])'],
    ['0x731133e9', 'mint(address,uint256,uint256,bytes)'],
    ['0x156e29f6', 'mint(address,uint256,uint256)'],

    // Zora / rewards
    ['0x0f4a1e5e', 'mintWithRewards(address,uint256,string,address)'],

    // thirdweb
    ['0x57bc3d78', 'claim(address,uint256,address,uint256,(bytes32[],uint256,uint256,address),bytes)'],

    // Art Blocks / generative
    ['0x26c43a11', 'purchaseTo(address,uint256)'],

    // Free / claim style
    ['0x11110000', 'freeMint()'],
    ['0x4d7cc1ec', 'freePlanting()'], // OEGP 0x460d7DFa…
    ['0x84bb1e42', 'claim(address,uint256,address,uint256,bytes32[],uint256,bytes)'],

    // Batch mints
    ['0xa945bf80', 'batchMint(uint256)'],
    ['0x2e7ba6ef', 'claim(uint256,address,uint256,bytes32[])'],
];

const KNOWN_MINT_SELECTORS: Record<string, string> = toSelectorMap(KNOWN_MINT_ENTRIES);

// ---- Known NON-MINT selectors (reject immediately) ----
const KNOWN_NON_MINT_ENTRIES: readonly (readonly [string, string])[] = [
    // ERC20
    ['0xa9059cbb', 'transfer(address,uint256)'],
    ['0x23b872dd', 'transferFrom(address,address,uint256)'],
    ['0x095ea7b3', 'approve(address,uint256)'],
    ['0x39509351', 'increaseAllowance(address,uint256)'],
    ['0xa457c2d7', 'decreaseAllowance(address,uint256)'],

    // NFT approvals / permits (not mints)
    ['0xa22cb465', 'setApprovalForAll(address,bool)'],
    ['0xd505accf', 'permit(address,address,uint256,uint256,uint8,bytes32,bytes32)'],
    ['0x2b67b570', 'permitTransferFrom (Permit2)'],
    ['0x0d58b1db', 'permitWitnessTransferFrom (Permit2)'],
    ['0x87013091', 'permitTransferFrom (Permit2 packed)'],

    // Uniswap / DEX swaps
    ['0x38ed1739', 'swapExactTokensForTokens'],
    ['0x7ff36ab5', 'swapExactETHForTokens'],
    ['0x18cbafe5', 'swapExactTokensForETH'],
    ['0x5c11d795', 'swapExactTokensForTokensSupportingFeeOnTransferTokens'],
    ['0xfb3bdb41', 'swapETHForExactTokens'],
    ['0x791ac947', 'swapExactTokensForETHSupportingFeeOnTransferTokens'],
    ['0x04e45aaf', 'exactInputSingle (Uniswap V3)'],
    ['0xb858183f', 'exactInput (Uniswap V3)'],
    ['0x414bf389', 'exactInputSingle (Uniswap V3)'],
    ['0xc04b8d59', 'exactInput (Uniswap V3)'],
    ['0x3593564c', 'execute (Universal Router)'],

    // Wrappers
    ['0xd0e30db0', 'deposit (WETH)'],
    ['0x2e1a7d4d', 'withdraw (WETH)'],

    // NFT marketplace (not mints)
    ['0xfb0f3ee1', 'fulfillBasicOrder (Seaport buy)'],
    ['0x87201b41', 'fulfillBasicOrder_efficient (Seaport buy)'],
    ['0xe7acab24', 'fulfillAdvancedOrder (Seaport)'],
    ['0xb3a34c4c', 'fulfillOrder (Seaport)'],
    ['0x8b7a92d2', 'fulfillAvailableAdvancedOrders (Seaport)'],
    ['0xf7013da0', 'matchAdvancedOrders (Seaport)'],
    ['0xf242432a', 'safeTransferFrom (ERC1155)'],
    ['0x42842e0e', 'safeTransferFrom (ERC721)'],
    ['0x2eb2c2d6', 'safeBatchTransferFrom (ERC1155)'],

    // Relay / meta-tx / smart-wallet execution (not mints)
    ['0x6a761202', 'execTransaction (Gnosis Safe)'],
    ['0x468721a7', 'execTransaction (Safe variant)'],
    ['0xb61d27f6', 'execute (forwarder/meta-tx)'],
    ['0x5194545c', 'multicall (relay batch)'],
    ['0x34fcd5be', 'executeBatch (Biconomy-style)'],
    ['0x34ee9791', 'execTransactionFromModule (Safe module)'],

    // Staking / governance
    ['0xa694fc3a', 'stake(uint256)'],
    ['0x2e17de78', 'unstake(uint256)'],
    ['0x5c19a95c', 'delegate(address)'],

    // Multicall / aggregators (common false positives with short calldata)
    ['0xac9650d8', 'multicall(bytes[])'],
    ['0x5ae401dc', 'multicall(uint256,bytes[])'],
    ['0x252dba42', 'aggregate((address,bytes)[])'],
];

const KNOWN_NON_MINT_SELECTORS: Record<string, string> = toSelectorMap(KNOWN_NON_MINT_ENTRIES);

function isValidHexCalldata(data: string): boolean {
    return /^0x[0-9a-fA-F]*$/.test(data);
}

/**
 * Classify a transaction's calldata to determine if it's likely a mint.
 */
export function classifyMintTransaction(
    data: string,
    value: string,
    _to: string | null,
    copyUnknownCalls: boolean = false
): MintClassification {
    // Empty calldata = simple ETH transfer
    if (!data || data === '0x' || data.length < 10) {
        return { isMint: false, confidence: 'high', selector: '0x', reason: 'Empty calldata (ETH transfer)' };
    }

    if (!isValidHexCalldata(data) || (data.length - 2) % 2 !== 0) {
        return {
            isMint: false,
            confidence: 'high',
            selector: data.slice(0, 10).toLowerCase(),
            reason: 'Invalid hex calldata',
        };
    }

    const selector = data.slice(0, 10).toLowerCase();

    // Check known mint selectors first
    if (KNOWN_MINT_SELECTORS[selector]) {
        return {
            isMint: true,
            confidence: 'high',
            selector,
            selectorName: KNOWN_MINT_SELECTORS[selector],
        };
    }

    // Check known non-mint selectors
    if (KNOWN_NON_MINT_SELECTORS[selector]) {
        return {
            isMint: false,
            confidence: 'high',
            selector,
            selectorName: KNOWN_NON_MINT_SELECTORS[selector],
            reason: `Known non-mint: ${KNOWN_NON_MINT_SELECTORS[selector]}`,
        };
    }

    const paid = BigInt(value) > 0n;

    // Known selector-only calls (e.g. freePlanting()) — 4-byte selector, no args
    if (!paid && data.length === 10 && KNOWN_MINT_SELECTORS[selector]) {
        return {
            isMint: true,
            confidence: 'high',
            selector,
            selectorName: KNOWN_MINT_SELECTORS[selector],
            reason: 'Known selector-only mint (0 ETH)',
        };
    }

    // Heuristic: exactly one full word after selector (mint(uint256)-shaped) + ETH
    if (data.length === 74 && paid) {
        return {
            isMint: true,
            confidence: 'medium',
            selector,
            reason: 'Unknown selector but matches mint(uint256) calldata shape with ETH value',
        };
    }

    // Broader "short + ETH" — many real mints use 2+ args; treat as low confidence
    // (stricter than old medium, reduces mempool false positives for auto-mint).
    if (data.length <= 138 && paid) {
        const bodyLen = data.length - 10;
        if (bodyLen > 0 && bodyLen % 64 === 0) {
            return {
                isMint: true,
                confidence: 'low',
                selector,
                reason: 'Short ABI-sized calldata with ETH — possible mint (low confidence)',
            };
        }
        return {
            isMint: false,
            confidence: 'medium',
            selector,
            reason: 'Odd-length calldata tail with ETH — unlikely mint layout',
        };
    }

    // Unknown selector, no ETH value, long calldata — uncertain
    if (copyUnknownCalls) {
        return {
            isMint: true,
            confidence: 'low',
            selector,
            reason: 'Unknown selector — COPY_UNKNOWN_MINT_CALLS enabled',
        };
    }

    // Default: reject unknown long calldata (marketplace buys, relays, complex calls)
    if (data.length > 138) {
        return {
            isMint: false,
            confidence: paid ? 'medium' : 'low',
            selector,
            reason: paid
                ? 'Unknown selector, long calldata with ETH — likely buy/relay/swap, not mint'
                : 'Unknown selector, no ETH value, long calldata — likely not a mint',
        };
    }

    // Unknown short call with no value — not a mint
    if (!paid) {
        return {
            isMint: false,
            confidence: 'medium',
            selector,
            reason: 'Unknown selector, no ETH value',
        };
    }

    // Unknown short paid call — low confidence only (automint should gate on confidence)
    return {
        isMint: true,
        confidence: 'low',
        selector,
        reason: 'Unknown short paid contract call — possible mint',
    };
}

/** Check if a selector is a known mint function */
export function isKnownMintSelector(selector: string): boolean {
    return selector.toLowerCase() in KNOWN_MINT_SELECTORS;
}

/** Get the human-readable name of a known selector */
export function getSelectorName(selector: string): string | undefined {
    return KNOWN_MINT_SELECTORS[selector.toLowerCase()] || KNOWN_NON_MINT_SELECTORS[selector.toLowerCase()];
}

/**
 * Classifier for tracked-whale txs (pending + confirmed).
 * Uses the strict mint heuristics, with a small boost for obvious free allowlist shapes.
 * Does NOT treat every contract call as a mint (avoids approvals, Seaport buys, relays).
 */
export function classifyTrackedWalletTx(
    data: string,
    value: string,
    to: string | null
): MintClassification {
    if (!data || data === '0x' || data.length < 10) {
        return { isMint: false, confidence: 'high', selector: '0x', reason: 'Empty calldata (ETH transfer)' };
    }

    if (!isValidHexCalldata(data)) {
        return {
            isMint: false,
            confidence: 'high',
            selector: data.slice(0, 10).toLowerCase(),
            reason: 'Invalid hex calldata',
        };
    }

    const selector = data.slice(0, 10).toLowerCase();

    if (KNOWN_NON_MINT_SELECTORS[selector]) {
        return {
            isMint: false,
            confidence: 'high',
            selector,
            selectorName: KNOWN_NON_MINT_SELECTORS[selector],
            reason: `Known non-mint: ${KNOWN_NON_MINT_SELECTORS[selector]}`,
        };
    }

    if (KNOWN_MINT_SELECTORS[selector]) {
        return {
            isMint: true,
            confidence: 'high',
            selector,
            selectorName: KNOWN_MINT_SELECTORS[selector],
        };
    }

    const paid = BigInt(value) > 0n;

    // Free allowlist / signature mints: 0 ETH, long calldata (standard approvals are ≤138 bytes)
    if (!paid && data.length > 200) {
        return {
            isMint: true,
            confidence: 'medium',
            selector,
            reason: 'Tracked wallet 0 ETH long calldata (likely allowlist/signature mint)',
        };
    }

    return classifyMintTransaction(data, value, to, false);
}
