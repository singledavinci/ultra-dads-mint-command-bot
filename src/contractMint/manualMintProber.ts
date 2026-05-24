import { getAddress, Interface } from 'ethers';
import type { JsonRpcProvider } from 'ethers';
import {
    buildSeaDropMintCalldata,
    findSeaDropPublicDrop,
    isSeaDropRouter,
    resolveSeaDropFeeRecipient,
    seaDropPublicMintBlockedReason,
} from '../services/seaDropBuilder.js';
import { classifyByAbiFunction } from './MintFunctionClassifier.js';
import { readOnChainPrice, resolveAbi } from './ABIResolver.js';
import { getContractMintConfig } from './config.js';
import { runSimulationGate } from './SimulationGate.js';
import type { ContractMintPlan, DetectedContractMint } from './types.js';
import { buildMintPlan } from './MintPlanBuilder.js';

const PROBE_IFACE = new Interface([
    'function mint()',
    'function freeMint()',
    'function mint(uint256 quantity)',
    'function publicMint(uint256 quantity)',
    'function claim(uint256 quantity)',
    'function mint(address to, uint256 quantity)',
    'function mintTo(address to, uint256 quantity)',
    'function purchase(uint256 quantity)',
    'function buy(uint256 quantity)',
]);

function weiHex(v: bigint): string {
    return v > 0n ? '0x' + v.toString(16) : '0x0';
}

export async function probeManualMintCandidates(params: {
    contractAddress: string;
    signerAddress: string;
    quantity: number;
    provider: JsonRpcProvider;
    chainId: number;
    maxEth?: number;
}): Promise<ContractMintPlan | null> {
    const cfg = getContractMintConfig();
    const contract = getAddress(params.contractAddress).toLowerCase();
    const signer = getAddress(params.signerAddress);
    const qty = params.quantity || cfg.defaultMintQuantity;
    const maxWei =
        params.maxEth !== undefined
            ? BigInt(Math.floor(params.maxEth * 1e18))
            : BigInt(Math.floor(cfg.maxMintValueEth * 1e18));

    const onChain = await readOnChainPrice(contract, params.provider);
    const unitPrice = onChain?.price ?? 0n;
    const totalValue = unitPrice * BigInt(qty);

    if (totalValue > maxWei) return null;

    const candidates: { name: string; data: string; value: string; category: ContractMintPlan['category'] }[] = [];

    for (const name of ['mint', 'freeMint'] as const) {
        try {
            candidates.push({
                name: `${name}()`,
                data: PROBE_IFACE.encodeFunctionData(name, []),
                value: weiHex(totalValue),
                category: 'SUPPORTED_PUBLIC_MINT',
            });
        } catch {
            /* skip */
        }
    }

    const qtyFns = ['mint(uint256)', 'publicMint(uint256)', 'claim(uint256)', 'purchase(uint256)', 'buy(uint256)'];
    for (const sig of qtyFns) {
        const name = sig.split('(')[0];
        try {
            candidates.push({
                name: sig,
                data: PROBE_IFACE.encodeFunctionData(name, [BigInt(qty)]),
                value: weiHex(totalValue),
                category: 'SUPPORTED_PUBLIC_MINT',
            });
        } catch {
            /* skip */
        }
    }

    const addrQtyFns = ['mint(address,uint256)', 'mintTo(address,uint256)'];
    for (const sig of addrQtyFns) {
        const name = sig.split('(')[0];
        try {
            candidates.push({
                name: sig,
                data: PROBE_IFACE.encodeFunctionData(name, [signer, BigInt(qty)]),
                value: weiHex(totalValue),
                category: 'SUPPORTED_PUBLIC_MINT',
            });
        } catch {
            /* skip */
        }
    }

    const drop = await findSeaDropPublicDrop(contract, params.provider);
    if (drop && !seaDropPublicMintBlockedReason(drop)) {
        const feeRecipient = await resolveSeaDropFeeRecipient(
            contract,
            params.provider,
            drop.router,
            drop.restrictFeeRecipients
        );
        const built = buildSeaDropMintCalldata({
            nftContract: contract,
            minter: signer,
            quantity: qty,
            seaDropRouter: drop.router,
            feeRecipient,
        });
        const seaTotal = drop.mintPrice * BigInt(qty);
        if (seaTotal <= maxWei) {
            candidates.push({
                name: 'mintPublic',
                data: built.data,
                value: weiHex(seaTotal),
                category: 'SUPPORTED_SEADROP_PUBLIC',
            });
        }
    }

    let best: ContractMintPlan | null = null;
    let bestCost = maxWei + 1n;

    for (const c of candidates) {
        const cls = classifyByAbiFunction(c.name.split('(')[0], []);
        if (cls.category === 'UNSUPPORTED' || cls.hasProofOrSignature) continue;

        const target = isSeaDropRouter(contract) ? contract : contract;
        const sim = await runSimulationGate({
            provider: params.provider,
            from: signer,
            to: c.category === 'SUPPORTED_SEADROP_PUBLIC' && drop ? drop.router : target,
            data: c.data,
            value: c.value,
        });
        if (sim.status !== 'passed') continue;

        const cost = BigInt(c.value || '0');
        if (cost <= bestCost) {
            bestCost = cost;
            best = {
                chainId: params.chainId,
                tokenContract: contract,
                executionTarget:
                    c.category === 'SUPPORTED_SEADROP_PUBLIC' && drop ? drop.router : contract,
                mintType: cost > 0n ? 'paid' : 'free',
                tokenStandard: 'unknown',
                functionName: c.name,
                selector: c.data.slice(0, 10),
                quantity: qty,
                value: c.value,
                calldata: c.data,
                confidence: 'medium',
                reason: `Manual probe: ${c.name}`,
                simulationStatus: 'passed',
                executable: true,
                category: c.category,
                estimatedGas: sim.gasEstimate,
            };
        }
    }

    if (best) return best;

    const detected: DetectedContractMint = {
        chainId: params.chainId,
        tokenContract: contract,
        executionTarget: contract,
        fromAddress: params.signerAddress,
        valueWei: weiHex(totalValue),
        calldata: '0x',
        selector: '0x',
        tokenStandard: 'unknown',
        quantity: qty,
        detectionSource: 'manual',
        isSeaDrop: false,
    };
    return buildMintPlan({ detected, signerAddress: signer, quantity: qty, provider: params.provider });
}
