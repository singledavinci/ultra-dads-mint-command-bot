import { JsonRpcProvider, Contract, Wallet, AbiCoder } from 'ethers';
import type { InterfaceAbi } from 'ethers';
import { getCachedSimulation, setCachedSimulation } from '../services/simulationCache';
import { hijackSeaDropCalldata, seaDropMinterIfNotPayerForSelfMint } from '../services/seaDropBuilder';
import { isRateLimitedRpcError, rpcRetry, sleepRpcGap, getCachedFeeData, withSerializedRpc, getLinkMintRpcGapMs } from '../services/rpcLimiter';
import { reserveNonce, confirmNonce, handleNonceError } from '../services/nonceManager';

/** Timeout for tx.wait() to prevent hanging forever */
const TX_WAIT_TIMEOUT_MS = parseInt(process.env.TX_WAIT_TIMEOUT_MS || '60000', 10);

/** Wrap tx.wait with a timeout so it never hangs */
export async function waitWithTimeout(tx: any, confirmations = 1): Promise<any> {
    const waitPromise = tx.wait(confirmations);
    const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`tx.wait timed out after ${TX_WAIT_TIMEOUT_MS}ms (tx may still confirm)`)), TX_WAIT_TIMEOUT_MS)
    );
    return Promise.race([waitPromise, timeoutPromise]);
}

/** Poll getTransactionReceipt until confirmed or timeout (used when engine returns hash-only). */
export async function waitForTxReceipt(
    provider: { getTransactionReceipt: (hash: string) => Promise<{ status?: number | null; blockNumber?: number | null } | null> },
    txHash: string,
    confirmations = 1
): Promise<{ status: number; blockNumber: number }> {
    const deadline = Date.now() + TX_WAIT_TIMEOUT_MS;
    const pollMs = 2500;
    let last: { status?: number | null; blockNumber?: number | null } | null = null;

    while (Date.now() < deadline) {
        try {
            last = await provider.getTransactionReceipt(txHash);
        } catch {
            /* RPC blip — retry */
        }
        if (last?.blockNumber != null) {
            return { status: last.status === 1 ? 1 : 0, blockNumber: Number(last.blockNumber) };
        }
        await new Promise(r => setTimeout(r, pollMs));
    }

    if (last?.blockNumber != null) {
        return { status: last.status === 1 ? 1 : 0, blockNumber: Number(last.blockNumber) };
    }
    throw new Error(`tx.wait timed out after ${TX_WAIT_TIMEOUT_MS}ms (tx may still confirm)`);
}

export interface MintConfig {
    contractAddress: string;
    abi: InterfaceAbi;
    functionName: string;
    args: unknown[];
    gasLimit?: bigint;
}

export const mintNFT = async (
    walletPrivateKey: string,
    config: MintConfig,
    provider: JsonRpcProvider
) => {
    const wallet = new Wallet(walletPrivateKey, provider);
    const contract = new Contract(config.contractAddress, config.abi, wallet);

    // Dynamic function call
    const tx = await contract[config.functionName](...config.args, {
        gasLimit: config.gasLimit,
    });

    return tx;
};

export const batchMint = async (
    wallets: string[], // private keys
    config: MintConfig,
    provider: JsonRpcProvider
) => {
    const results: PromiseSettledResult<unknown>[] = [];
    for (let i = 0; i < wallets.length; i++) {
        // Prevent RPC rate limits (429 Too Many Requests) by staggering calls by 500ms
        if (i > 0) await new Promise(resolve => setTimeout(resolve, 500));
        try {
            const tx = await mintNFT(wallets[i], config, provider);
            results.push({ status: 'fulfilled', value: tx });
        } catch (err) {
            results.push({ status: 'rejected', reason: err });
        }
    }
    return results;
};

import { formatEther, parseUnits, type FeeData } from 'ethers';
import { computePreflightGasCost, totalRequiredWei } from '../engine/gasCost';

/** ETH needed for mint value + realistic gas (aligned with copyTrade balance check). */
export function estimateMintRequiredWei(
    mintValueWei: bigint,
    feeData: FeeData,
    options?: { gasLimit?: bigint; overdrive?: boolean }
): bigint {
    const estimatedGas = options?.gasLimit ?? 120_000n;
    const gasLimit = (estimatedGas * 115n) / 100n;
    let maxFee =
        feeData.maxFeePerGas ?? feeData.gasPrice ?? parseUnits('12', 'gwei');
    if (options?.overdrive && feeData.maxFeePerGas) {
        maxFee = (feeData.maxFeePerGas * 400n) / 100n;
    } else if (feeData.maxFeePerGas) {
        maxFee = (feeData.maxFeePerGas * 110n) / 100n;
    }
    const maxPriority = feeData.maxPriorityFeePerGas ?? parseUnits('0.1', 'gwei');
    const bufferEth = parseFloat(process.env.MIN_WALLET_BUFFER_ETH || '0.0001');
    const preflight = computePreflightGasCost({
        feeData,
        gasLimit,
        estimatedGas,
        maxFeePerGas: maxFee,
        maxPriorityFeePerGas: maxPriority,
        bufferEth,
    });
    return totalRequiredWei(mintValueWei, preflight);
}

function formatEthShort(wei: bigint, maxDecimals = 6): string {
    const s = formatEther(wei);
    if (!s.includes('.')) return s;
    const [whole, frac = ''] = s.split('.');
    return `${whole}.${frac.slice(0, maxDecimals)}`.replace(/\.$/, '');
}

// Nonce management now handled by src/services/nonceManager.ts
// The old localNonceTracker is replaced with reserveNonce/confirmNonce/handleNonceError

export const copyTrade = async (
    walletPrivateKey: string,
    to: string,
    data: string,
    value: string,
    provider: JsonRpcProvider,
    feeData?: FeeData | null,
    options?: { 
        maxMintLimit?: string, 
        gasBribeGwei?: string, 
        mevProtection?: boolean, 
        skipSimulation?: boolean, 
        disableMaxMint?: boolean, 
        nonce?: number,
        balance?: bigint,
        gasLimit?: bigint,
        overdrive?: boolean,
        /** Pace + retry balance/fee reads (strict RPC tiers / link mint). */
        rpcPacing?: boolean,
    }
) => {
    // 1. Max Mint (Slippage) Check
    if (options?.maxMintLimit && parseFloat(options.maxMintLimit) > 0) {
        if (parseFloat(formatEther(value)) > parseFloat(options.maxMintLimit)) {
            throw new Error(`Value ${formatEther(value)} ETH exceeds Max Mint Limit of ${options.maxMintLimit} ETH`);
        }
    }

    // 2. Gas Bidding / Bribery (EIP-1559 Nitro Buffer)
    let currentFee = feeData;
    if (!currentFee) {
        if (options?.rpcPacing) {
            await sleepRpcGap();
            currentFee = await rpcRetry(() => getCachedFeeData(provider), 'copyTrade/fee');
        } else {
            currentFee = await provider.getFeeData();
        }
    }
    let priorityFee = currentFee.maxPriorityFeePerGas || 100000000n; // fallback 0.1 gwei
    
    // Aggressive Max Base Fee:
    // Default: Standard + 10% safety buffer to prevent 'Insufficient Funds' on normal wallets.
    // Overdrive: 4x Base Fee buffer (requires high balances) specifically for sniping hype mints.
    let maxFee =
        currentFee.maxFeePerGas ?? currentFee.gasPrice ?? parseUnits('12', 'gwei');
    if (!options?.overdrive) {
        maxFee = (maxFee * 110n) / 100n;
    }
    if (options?.overdrive && currentFee.maxFeePerGas) {
        console.log('🚀 OVERDRIVE MODE: Bidding 400% on base fee!');
        maxFee = (currentFee.maxFeePerGas * 400n) / 100n;
    }

    if (options?.gasBribeGwei && parseFloat(options.gasBribeGwei) > 0) {
        const bribeWei = parseUnits(options.gasBribeGwei, 'gwei');
        priorityFee = priorityFee + bribeWei;
        maxFee = maxFee + bribeWei; // Accommodate the bribe headroom
    } else {
        priorityFee = options?.overdrive ? (priorityFee * 150n) / 100n : (priorityFee * 110n) / 100n; // 50% vs 10% tip buffer
    }

    // 3. MEV Protection
    let executionProvider = provider;
    if (options?.mevProtection) {
        executionProvider = new JsonRpcProvider('https://rpc.mevblocker.io');
    }

    const wallet = new Wallet(walletPrivateKey, executionProvider);

    const txObj: any = {
        to,
        data,
        value,
        maxFeePerGas: maxFee,
        maxPriorityFeePerGas: priorityFee,
        nonce: options?.nonce
    };

    // If skipping simulation, we MUST inject a safe blind gas limit
    if (options?.skipSimulation && !txObj.gasLimit) {
        txObj.gasLimit = 300000n; // Standard blind gas limit (Optimized for balance checks)
    }

    try {
        let balance = options?.balance;
        if (balance === undefined) {
            if (options?.rpcPacing) {
                await sleepRpcGap();
                balance = await rpcRetry(() => provider.getBalance(wallet.address), 'copyTrade/balance');
            } else {
                balance = await provider.getBalance(wallet.address);
            }
        }
        const estimatedGas = options?.gasLimit || txObj.gasLimit || 120_000n;
        const gasLimitForCheck = (estimatedGas * 115n) / 100n;
        const bufferEth = parseFloat(process.env.MIN_WALLET_BUFFER_ETH || '0.0001');
        const preflight = computePreflightGasCost({
            feeData: currentFee,
            gasLimit: gasLimitForCheck,
            estimatedGas,
            maxFeePerGas: maxFee,
            maxPriorityFeePerGas: priorityFee,
            bufferEth,
        });
        const requiredFunds = totalRequiredWei(BigInt(value), preflight);

        if (balance < requiredFunds) {
            const missing = requiredFunds - balance;
            throw new Error(`Insufficient funds: Need ${formatEther(requiredFunds).slice(0, 7)} ETH (est. gas ~${preflight.gasReserveEth.slice(0, 7)}), but only have ${formatEther(balance).slice(0, 7)} ETH. Missing ~${formatEther(missing).slice(0, 7)} ETH.`);
        }

        let retryCount = 0;
        const sendWithRetry = async (): Promise<any> => {
            try {
                return await wallet.sendTransaction(txObj);
            } catch (err: any) {
                if (retryCount < 5 && isRateLimitedRpcError(err)) {
                    retryCount++;
                    await new Promise(r => setTimeout(r, 600 * retryCount));
                    return sendWithRetry();
                }
                throw err;
            }
        };

        const tx = await sendWithRetry();
        return tx;
    } catch (err: any) {
        // Advanced Ethers v6 Error Extraction + Revert Reason Decoding
        let msg = err.message || 'Unknown Execution Error';
        
        // 1. Try to decode revert reason from error data
        if (err.data && err.data.startsWith('0x08c379a0')) {
            // Standard Error(string) revert
            try {
                const { AbiCoder } = await import('ethers');
                const coder = new AbiCoder();
                const reason = coder.decode(['string'], '0x' + err.data.slice(10))[0];
                msg = `❌ Contract Reverted: ${reason}`;
            } catch { /* decoding failed, continue with raw message */ }
        } else if (err.reason) {
            msg = `❌ Reverted: ${err.reason}`;
        } else if (err.revert?.args?.[0]) {
            msg = `❌ Reverted: ${err.revert.args[0]}`;
        }

        // 2. Extract from nested ethers v6 error structures
        if (msg === (err.message || 'Unknown Execution Error')) {
            if (err.info?.error?.data && typeof err.info.error.data === 'string' && err.info.error.data.startsWith('0x08c379a0')) {
                try {
                    const { AbiCoder } = await import('ethers');
                    const coder = new AbiCoder();
                    const reason = coder.decode(['string'], '0x' + err.info.error.data.slice(10))[0];
                    msg = `❌ Contract Reverted: ${reason}`;
                } catch {}
            } else if (err.info?.error?.message) {
                msg = err.info.error.message;
            } else if (err.error?.message) {
                msg = err.error.message;
            } else if (err.data?.message) {
                msg = err.data.message;
            }
        }
        
        // 3. Handle specialized RPC error payloads first (before coalesce massage hides them)
        if (isRateLimitedRpcError(err)) {
            throw new Error(
                '❌ RPC rate limit: provider capped requests (e.g. 15/s). Add a second RPC to PROVIDER_URL, upgrade your plan, or set LINK_MINT_RPC_GAP_MS=300+ on Railway.'
            );
        }

        // 3b. Legacy Alchemy/Infura wording
        if (msg.includes('429') || JSON.stringify(err).includes('compute units')) {
            msg = '❌ RPC rate limit: your RPC rejected requests (429 / compute units). Add URLs to PROVIDER_URL or raise tier.';
        }

        // 4. Handle "Could not coalesce" — unpack inner JSON only if not already rate-limited
        if (msg.includes('could not coalesce error') && err.info) {
            const inner = err.info.error || err.info;
            const innerMsg = inner?.message || JSON.stringify(inner).slice(0, 200);
            if (isRateLimitedRpcError(inner) || /32007|request limit|\/second/i.test(innerMsg)) {
                msg =
                    '❌ RPC rate limit (coalesced). Space out calls: LINK_MINT_RPC_GAP_MS=300, RPC_RETRY_ATTEMPTS=10, or use multiple RPC endpoints.';
            } else {
                msg = innerMsg;
            }
        }
        if (msg.includes('exceeded its compute units')) {
            msg = '❌ RPC Rate Limit: Alchemy Compute Units Exhausted. (Upgrade Alchemy or use /setrpc)';
        } else if (msg.includes('nonce too low')) {
            msg = '❌ Nonce Too Low (Previous transaction still pending)';
        } else if (msg.includes('replacement transaction underpriced')) {
            msg = '❌ Gas Price Too Low (Increase /bribe)';
        } else if (msg.includes('PayerNotAllowed')) {
            msg = '❌ SeaDrop: PayerNotAllowed (Mint is likely Private/Whitelist only)';
        } else if (msg.includes('already minted') || msg.includes('already claimed')) {
            msg = `❌ Already Minted: This wallet already minted from this contract`;
        } else if (msg.includes('not open') || msg.includes('not active') || msg.includes('not started')) {
            msg = `❌ Mint Not Open: The mint has not started yet`;
        } else if (msg.includes('sold out') || msg.includes('max supply') || msg.includes('exceeds max')) {
            msg = `❌ Sold Out: Collection has reached max supply`;
        } else if (msg.includes('max per wallet') || msg.includes('max mint') || msg.includes('limit reached')) {
            msg = `❌ Wallet Limit: Max per-wallet mint limit reached`;
        } else if (msg.includes('insufficient') && msg.includes('fund')) {
            // Keep the detailed insufficient funds message from earlier in the function
        } else if (msg.includes('whitelist') || msg.includes('allowlist') || msg.includes('not eligible')) {
            msg = `❌ Not Whitelisted: This wallet is not on the allowlist`;
        } else if (msg.includes('wrong value') || msg.includes('incorrect price') || msg.includes('invalid price')) {
            msg = `❌ Wrong Price: The mint value sent was incorrect`;
        }

        // AUTO-RETRY ON SIMULATION FAILURE (Turbo Blind Broadcast)
        if (msg.includes('missing revert data') && !options?.skipSimulation) {
            const TURBO_LIMIT = 300000n;
            console.warn(`[AutoRetry] Simulation failed. Re-attempting with Turbo Blind Broadcast (Gas: ${TURBO_LIMIT})...`);
            try {
                txObj.gasLimit = TURBO_LIMIT; 
                const tx = await wallet.sendTransaction(txObj);
                return tx;
            } catch (retryErr: any) {
                // Return original error if retry also fails
            }
        }
        throw new Error(msg);
    }
};

export const batchCopyTrade = async (
    wallets: string[],
    to: string,
    data: string,
    value: string,
    provider: JsonRpcProvider,
    options?: {
        maxMintLimit?: string;
        gasBribeGwei?: string;
        mevProtection?: boolean;
        skipSimulation?: boolean;
        disableMaxMint?: boolean;
        nonce?: number;
        overdrive?: boolean;
        /** Sequential, paced simulations — use for link mint / strict RPC tiers. */
        throttleSimulations?: boolean;
    },
    whaleAddress?: string | null
) => {
    let finalData = data;
    let finalValue = value;

    // Known routing contracts that cannot be simulated with generic selectors.
    // These are pass-through contracts (SeaDrop, aggregators, etc.) where the
    // whale's original calldata IS the correct payload — just skip simulation
    // and blind-broadcast with an explicit gas limit.
    const KNOWN_ROUTERS = new Set([
        '0x00005ea00ac477b1030ce78506496e8c2de24bf5', // OpenSea SeaDrop v1.0
        '0x0000000000664ceffed39244a8312556a900b938', // OpenSea SeaDrop v1.1
        '0x00000000000001ad428e4906ae943a6d5e6f53d3', // OpenSea Seaport 1.4
        '0x00000000000000adc04c56bf30ac9d3c0aaf14dc', // OpenSea Seaport 1.5
        '0x4d224452801aced8b2f0aebe155379bb5d594381', // ApeCoin NFT Mint Router
    ]);

    if (KNOWN_ROUTERS.has(to.toLowerCase())) {
        const selector = data.slice(0, 10);
        const isSeaDropPublic = selector === '0x51061988';
        const isSeaDropAllowlist = selector === '0x46332f08';

        if (isSeaDropPublic) {
            console.log(`[MintCore] 🌊 SeaDrop mintPublic detected. Enabling simulation for pre-flight check.`);
        } else if (isSeaDropAllowlist) {
            console.log(`[MintCore] 🔒 SeaDrop mintAllowlist detected. Simulation will determine if public fallback is needed.`);
        } else {
            console.log(`[MintCore] ⚡ Known routing contract detected (${to.slice(0, 10)}...). Attempting simulation — fallback enabled.`);
        }
    }

    // 0. Nitro Parallel Simulation Engine (with cache)
    if (wallets.length > 0 && !options?.skipSimulation && !options?.disableMaxMint) {
        // Check simulation cache first
        const cached = getCachedSimulation(to, data);
        if (cached) {
            console.log(`[MintCore] ⚡ Using cached simulation for ${to.slice(0, 10)}... selector=${cached.selector} qty=${cached.quantity}`);
            finalData = cached.data;
            finalValue = cached.value;
        } else {
        const throttle = options?.throttleSimulations === true;
        if (throttle) {
            console.log('[MintCore] 🐢 Throttled simulations (link mint / strict RPC)');
        }
        const simWallet = new Wallet(wallets[0], provider);
        const coder = new AbiCoder();
        const qtyLadder = [20, 10, 5, 3, 2, 1];
        let primarySucceeded = false;

        const runEstimate = async (
            req: { to: string; data: string; value: string; from: string },
            label: string
        ) => {
            if (throttle) {
                return withSerializedRpc(async () => {
                    await sleepRpcGap();
                    return rpcRetry(() => provider.estimateGas(req), label);
                });
            }
            return provider.estimateGas(req);
        };

        const runCall = async (
            req: { to: string; data: string; value: string; from: string },
            label: string
        ) => {
            if (throttle) {
                return withSerializedRpc(async () => {
                    await sleepRpcGap();
                    return rpcRetry(() => provider.call(req), label);
                });
            }
            return provider.call(req);
        };

        // Try dynamically hijacking the Whale's payload if it's a standard single-parameter token counter
        if (data.length === 74) {
            console.log('🔍 Whale payload is standard 1-param sequence. Testing Nitro Max-Mint Overdrive...');
            const selector = data.slice(0, 10);
            try {
                const decodedAmt = coder.decode(['uint256'], '0x' + data.slice(10))[0];
                const baseValue = BigInt(value) / BigInt(decodedAmt.toString() === '0' ? '1' : decodedAmt);

                let bestSim:
                    | { qty: number; testData: string; testValue: string; success: true }
                    | undefined;

                if (throttle) {
                    for (const qty of qtyLadder) {
                        const testData = selector + coder.encode(['uint256'], [qty]).slice(2);
                        const testValue = '0x' + (baseValue * BigInt(qty)).toString(16);
                        try {
                            await runCall(
                                { to, data: testData, value: testValue, from: simWallet.address },
                                `nitroQty/${qty}`
                            );
                            bestSim = { qty, testData, testValue, success: true };
                            break;
                        } catch {
                            /* try next qty */
                        }
                    }
                } else {
                    const simResults = await Promise.all(
                        qtyLadder.map(async (qty) => {
                            const testData = selector + coder.encode(['uint256'], [qty]).slice(2);
                            const testValue = '0x' + (baseValue * BigInt(qty)).toString(16);
                            try {
                                await provider.call({
                                    to,
                                    data: testData,
                                    value: testValue,
                                    from: simWallet.address,
                                });
                                return { qty, testData, testValue, success: true as const };
                            } catch {
                                return { qty, success: false as const };
                            }
                        })
                    );
                    bestSim = simResults.find(
                        (r): r is { qty: number; testData: string; testValue: string; success: true } =>
                            r.success === true
                    );
                }

                if (bestSim) {
                    console.log(`🧨 NITRO MAX MINT: scan found ${bestSim.qty} per wallet!`);
                    finalData = bestSim.testData;
                    finalValue = bestSim.testValue;
                    setCachedSimulation(to, data, {
                        selector: data.slice(0, 10),
                        data: bestSim.testData,
                        value: bestSim.testValue,
                        quantity: bestSim.qty,
                    });
                    primarySucceeded = true;
                }
            } catch {
                /* decoding offset mismatch, ignore */
            }
        }

        if (!primarySucceeded) {
            try {
                console.log('🔍 Executing strict Native Whale Payload Simulation...');
                await runEstimate(
                    { to, data: finalData, value: finalValue, from: simWallet.address },
                    'primarySim'
                );
                console.log('✅ Primary Simulation Passed.');
                primarySucceeded = true;
            } catch (err) {
                console.warn(`⚠️ Primary Simulation Reverted. Whale payload private. Testing Fallback Matrix...`);

                const selectors = [
                    '0xa0712d68',
                    '0xf3b2dc9d',
                    '0x33b66418',
                    '0x1249c58b',
                    '0x51061988',
                    '0xefef39a1',
                    '0x11110000',
                ];

                const tryFallbackCell = async (
                    selector: string,
                    qty: number
                ): Promise<{ data: string; value: string } | null> => {
                    let testData: string;
                    if (selector === '0x51061988' && data.length >= 266) {
                        const nft = '0x' + data.slice(34, 74);
                        const feeRecipient = '0x' + data.slice(98, 138);
                        testData =
                            selector +
                            coder
                                .encode(
                                    ['address', 'address', 'address', 'uint256'],
                                    [nft, feeRecipient, seaDropMinterIfNotPayerForSelfMint(), qty]
                                )
                                .slice(2);
                    } else if (selector === '0x51061988') return null;
                    else testData = selector + coder.encode(['uint256'], [qty]).slice(2);

                    try {
                        await runEstimate(
                            { to, data: testData, value: '0x0', from: simWallet.address },
                            'fb/free'
                        );
                        return { data: testData, value: '0x0' };
                    } catch {
                        let whaleQty = 1n;
                        if (data.length === 74) whaleQty = BigInt('0x' + data.slice(10));
                        else if (data.length >= 266 && data.slice(0, 10) === '0x51061988')
                            whaleQty = BigInt('0x' + data.slice(202, 266));

                        const basePrice = BigInt(value) / (whaleQty || 1n);
                        const scaledValue = '0x' + (basePrice * BigInt(qty)).toString(16);
                        try {
                            await runEstimate(
                                { to, data: testData, value: scaledValue, from: simWallet.address },
                                'fb/paid'
                            );
                            return { data: testData, value: scaledValue };
                        } catch {
                            return null;
                        }
                    }
                };

                let firstHit: { data: string; value: string } | null = null;

                if (throttle) {
                    outer: for (const selector of selectors) {
                        for (const qty of qtyLadder) {
                            const hit = await tryFallbackCell(selector, qty);
                            if (hit) {
                                firstHit = hit;
                                break outer;
                            }
                        }
                    }
                } else {
                    const allSims: Promise<{ data: string; value: string } | null>[] = [];
                    for (const selector of selectors) {
                        for (const qty of qtyLadder) {
                            allSims.push(tryFallbackCell(selector, qty));
                        }
                    }
                    const results = await Promise.all(allSims);
                    firstHit = results.find((r) => r !== null) ?? null;
                }

                if (firstHit) {
                    console.log(
                        `🔥 NITRO FALLBACK SECURED! Data: ${firstHit.data.slice(0, 10)}... Value: ${firstHit.value}`
                    );
                    finalData = firstHit.data;
                    finalValue = firstHit.value;
                    setCachedSimulation(to, data, {
                        selector: firstHit.data.slice(0, 10),
                        data: firstHit.data,
                        value: firstHit.value,
                        quantity: 1,
                    });
                } else {
                    console.warn('[MintCore] All fallback routes failed. Blind-broadcast mode active.');
                    options = { ...options, skipSimulation: true };
                }
            }
        }
        } // end else (no cache hit)
    }

    // 1. NITRO PRE-FETCH: Nonces, Balances, and Fees (with RPC rate-limit survival)
    let feeData: any;
    try {
        if (options?.throttleSimulations) {
            feeData = await withSerializedRpc(async () => {
                await sleepRpcGap();
                return getCachedFeeData(provider);
            });
        } else {
            feeData = await getCachedFeeData(provider);
        }
    } catch (e) {
        console.warn('[MintCore] Could not fetch real-time fee data. Using safe network defaults.');
        feeData = { maxFeePerGas: 50000000000n, maxPriorityFeePerGas: 1500000000n };
    }

    const nitroMetrics: any[] = [];
    const skippedWallets: Array<{ address: string; reason: string }> = [];
    
    // Per-wallet pre-flight with retry — one 429 does NOT abort the batch
    const { safePreflightWallet } = await import('../services/rpcLimiter');
    
    for (let i = 0; i < wallets.length; i++) {
        const key = wallets[i];
        const wallet = new Wallet(key, provider);

        const result = options?.throttleSimulations
            ? await safePreflightWallet(async () => {
                  await sleepRpcGap();
                  const rpcNonce = await rpcRetry(
                      () => provider.getTransactionCount(wallet.address, 'pending'),
                      `nonce/W${i + 1}`
                  );
                  await sleepRpcGap();
                  const balance = await rpcRetry(
                      () => provider.getBalance(wallet.address),
                      `balance/W${i + 1}`
                  );
                  const burstNonce = reserveNonce(wallet.address, rpcNonce);
                  return { key, nonce: burstNonce, balance, address: wallet.address };
              }, `W#${i + 1}`)
            : await safePreflightWallet(async () => {
                  const [rpcNonce, balance] = await Promise.all([
                      provider.getTransactionCount(wallet.address, 'pending'),
                      provider.getBalance(wallet.address),
                  ]);
                  const burstNonce = reserveNonce(wallet.address, rpcNonce);
                  return { key, nonce: burstNonce, balance, address: wallet.address };
              }, `W#${i + 1}`);

        if (result === null) {
            // Wallet skipped due to RPC 429 after retries
            skippedWallets.push({ address: wallet.address, reason: 'RPC rate limit (429)' });
            continue;
        }

        const requiredWei = estimateMintRequiredWei(BigInt(finalValue), feeData, {
            overdrive: options?.overdrive,
        });
        if (result.balance < requiredWei) {
            skippedWallets.push({
                address: wallet.address,
                reason: `Insufficient gas ETH (has ${formatEthShort(result.balance)}, needs ~${formatEthShort(requiredWei)} incl. gas; mint value ${formatEthShort(BigInt(finalValue))})`,
            });
            continue;
        }

        nitroMetrics.push(result);

        // Small stagger between wallet pre-flights
        if (i < wallets.length - 1) {
            const gap = options?.throttleSimulations ? getLinkMintRpcGapMs() : 150;
            await new Promise((r) => setTimeout(r, gap));
        }
    }

    if (skippedWallets.length > 0) {
        console.log(`[Batch] ⏭️ Skipped ${skippedWallets.length} wallet(s): ${skippedWallets.map(w => w.reason.slice(0, 25)).join(', ')}`);
    }

    if (nitroMetrics.length === 0) {
        console.warn('[Batch] ❌ No wallets passed pre-flight. Aborting batch.');
        return skippedWallets.map(w => ({ status: 'rejected' as const, reason: new Error(w.reason) }));
    }

    console.log(`[Batch] 🚀 BURST MODE: Broadcasting ${nitroMetrics.length}/${wallets.length} wallets (${skippedWallets.length} skipped)`);

    const results: any[] = [];

    if (options?.throttleSimulations) {
        for (let i = 0; i < nitroMetrics.length; i++) {
            const { key, nonce, address, balance } = nitroMetrics[i];
            let subData = finalData;

            const seaDropHijacked = hijackSeaDropCalldata(subData, address);
            if (seaDropHijacked) {
                subData = seaDropHijacked;
                console.log(
                    `[Safety] SeaDrop calldata re-encoded for minter ${address.slice(0, 10)}... (public or allowlist)`
                );
            } else if (whaleAddress && whaleAddress.startsWith('0x')) {
                const paddedWhale = whaleAddress.toLowerCase().replace('0x', '').padStart(64, '0');
                const paddedMine = address.toLowerCase().replace('0x', '').padStart(64, '0');
                if (subData.toLowerCase().includes(paddedWhale)) {
                    subData = subData.toLowerCase().replace(new RegExp(paddedWhale, 'g'), paddedMine);
                    console.log(`[Safety] 🛡️ Whale address deep-swapped in payload for: ${address}`);
                }
            }

            if (i > 0) await sleepRpcGap();

            try {
                const tx = await copyTrade(key, to, subData, finalValue, provider, feeData, {
                    ...options,
                    nonce,
                    balance,
                    rpcPacing: true,
                } as any);
                confirmNonce(address, nonce);
                results.push({ status: 'fulfilled' as const, value: tx });
            } catch (err: any) {
                handleNonceError(address, err.message || '');
                results.push({ status: 'rejected' as const, reason: err });
            }
        }
        return results;
    }

    for (let i = 0; i < nitroMetrics.length; i++) {
        const { key, nonce, address, balance } = nitroMetrics[i];
        let subData = finalData;

        const seaDropHijacked = hijackSeaDropCalldata(subData, address);
        if (seaDropHijacked) {
            subData = seaDropHijacked;
            console.log(`[Safety] SeaDrop calldata re-encoded for minter ${address.slice(0, 10)}... (public or allowlist)`);
        } else if (whaleAddress && whaleAddress.startsWith('0x')) {
            // Whale Deep Swap — skip raw substring for SeaDrop; allowlist proofs embed address-like words
            const paddedWhale = whaleAddress.toLowerCase().replace('0x', '').padStart(64, '0');
            const paddedMine = address.toLowerCase().replace('0x', '').padStart(64, '0');
            if (subData.toLowerCase().includes(paddedWhale)) {
                subData = subData.toLowerCase().replace(new RegExp(paddedWhale, 'g'), paddedMine);
                console.log(`[Safety] 🛡️ Whale address deep-swapped in payload for: ${address}`);
            }
        }

        // Stagger is reduced to 50ms for performance, but kept to avoid instant IP bans
        if (i > 0) await new Promise(r => setTimeout(r, 50));

        const p = (async () => {
            try {
                // IMPORTANT: We pass 'nonce', 'balance', and 'feeData' directly to skip internal Ethers RPC calls
                const tx = await copyTrade(key, to, subData, finalValue, provider, feeData, {
                    ...options,
                    nonce,
                    balance,
                } as any);
                // Confirm nonce was used successfully
                confirmNonce(address, nonce);
                return { status: 'fulfilled' as const, value: tx };
            } catch (err: any) {
                // Handle nonce errors — reset cache so next attempt re-fetches
                handleNonceError(address, err.message || '');
                return { status: 'rejected' as const, reason: err };
            }
        })();
        
        results.push(p);
    }

    return await Promise.all(results);
};
