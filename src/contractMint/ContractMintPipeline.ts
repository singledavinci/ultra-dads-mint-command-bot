import type { JsonRpcProvider } from 'ethers';
import { CopyMintEngine } from '../engine/CopyMintEngine.js';
import { DetectionEngine } from '../engine/DetectionEngine.js';
import type { DetectedMint } from '../utils/trackerCore.js';
import { getContractMintConfig } from './config.js';
import { ContractMintDetector } from './ContractMintDetector.js';
import { buildMintPlan } from './MintPlanBuilder.js';
import { runSimulationGate } from './SimulationGate.js';
import { formatContractMintAlert } from './alertFormatter.js';
import { idempotencyKey, shouldProcess, wasSeen } from './idempotency.js';
import type { ContractMintInput, ContractMintPipelineResult, ContractMintPlan } from './types.js';
import { normalizeContractMintInput } from './inputNormalizer.js';
import { rewriteMintCalldataForWallet } from '../services/calldataRewriter.js';
import { resolveAbi } from './ABIResolver.js';
import { probeManualMintCandidates } from './manualMintProber.js';

let lastPlan: ContractMintPlan | undefined;
let lastResult: ContractMintPipelineResult | undefined;

export function getLastContractMintResult(): ContractMintPipelineResult | undefined {
    return lastResult;
}

export function getLastContractMintPlan(): ContractMintPlan | undefined {
    return lastPlan;
}

export class ContractMintPipeline {
    private detector: ContractMintDetector;

    constructor(private readonly provider: JsonRpcProvider) {
        this.detector = new ContractMintDetector(provider);
    }

    async processInput(
        input: ContractMintInput,
        execute?: { privateKeys: string[]; options?: Record<string, unknown> }
    ): Promise<ContractMintPipelineResult> {
        const cfg = getContractMintConfig();
        if (!cfg.contractMintEnabled) {
            return { alertText: 'Contract mint disabled', executed: false };
        }

        const normalized = normalizeContractMintInput(input);
        let detected = await this.detector.detectFromInput(normalized);

        if (!detected && normalized.contractAddress && normalized.signerAddress) {
            const probed = await probeManualMintCandidates({
                contractAddress: normalized.contractAddress,
                signerAddress: normalized.signerAddress,
                quantity: normalized.quantity || cfg.defaultMintQuantity,
                provider: this.provider,
                chainId: normalized.chainId ?? parseInt(process.env.CHAIN_ID || '1', 10),
                maxEth: normalized.maxEth,
            });
            if (probed?.executable && probed.simulationStatus === 'passed') {
                const result: ContractMintPipelineResult = {
                    detected: {
                        chainId: probed.chainId,
                        tokenContract: probed.tokenContract,
                        executionTarget: probed.executionTarget,
                        fromAddress: normalized.signerAddress,
                        valueWei: probed.value,
                        calldata: probed.calldata,
                        selector: probed.selector,
                        tokenStandard: probed.tokenStandard,
                        quantity: probed.quantity,
                        detectionSource: 'manual',
                        isSeaDrop: probed.category === 'SUPPORTED_SEADROP_PUBLIC',
                    },
                    plan: probed,
                    alertText: '',
                    executed: false,
                };
                result.alertText = formatContractMintAlert(result);
                lastResult = result;
                lastPlan = probed;
                if (execute?.privateKeys?.length && !cfg.dryRun && probed.executable) {
                    return this.processDetected(result.detected!, {
                        signerAddress: normalized.signerAddress,
                        quantity: normalized.quantity,
                        execute,
                        alertMessageId: normalized.alertMessageId,
                    });
                }
                return result;
            }
            detected = {
                chainId: normalized.chainId!,
                tokenContract: normalized.contractAddress,
                executionTarget: normalized.contractAddress,
                whaleAddress: normalized.whaleAddress,
                fromAddress: normalized.whaleAddress || normalized.signerAddress,
                valueWei: '0x0',
                calldata: '0x',
                selector: '0x',
                tokenStandard: 'unknown',
                quantity: normalized.quantity || 1,
                detectionSource: 'manual',
                isSeaDrop: false,
            };
        }

        if (!detected) {
            const r = { alertText: 'No mint detected from input', executed: false };
            lastResult = r;
            return r;
        }

        return this.processDetected(detected, {
            signerAddress: normalized.signerAddress!,
            quantity: normalized.quantity,
            execute,
            alertMessageId: normalized.alertMessageId,
        });
    }

    async buildWhaleMintPlan(
        mint: DetectedMint,
        params: { signerAddress: string; quantity?: number }
    ): Promise<ContractMintPipelineResult> {
        const cfg = getContractMintConfig();
        if (!cfg.contractMintEnabled || !cfg.copyMintEnabled) {
            return { alertText: 'Copy mint disabled', executed: false };
        }

        const detected = this.detector.detectFromTrackedTx({
            hash: mint.hash,
            from: mint.from,
            to: mint.to,
            value: mint.value,
            data: mint.data,
        });

        if (!detected) {
            return { alertText: 'Not a contract mint tx', executed: false };
        }

        const enriched = await this.enrichWhaleDetection(mint, detected);

        return this.processDetected(enriched, {
            signerAddress: params.signerAddress,
            quantity: params.quantity,
            alertMessageId: mint.hash,
            skipPipelineSimulation: getContractMintConfig().copyMintSkipPipelineSim,
        });
    }

    async processWhaleMint(
        mint: DetectedMint,
        params: {
            signerAddress: string;
            privateKeys: string[];
            quantity?: number;
            options?: Record<string, unknown>;
        }
    ): Promise<ContractMintPipelineResult> {
        const cfg = getContractMintConfig();
        if (!cfg.contractMintEnabled || !cfg.copyMintEnabled) {
            return { alertText: 'Copy mint disabled', executed: false };
        }

        const detected = this.detector.detectFromTrackedTx({
            hash: mint.hash,
            from: mint.from,
            to: mint.to,
            value: mint.value,
            data: mint.data,
        });

        if (!detected) {
            return { alertText: 'Not a contract mint tx', executed: false };
        }

        const execKey = idempotencyKey([
            'exec',
            String(detected.chainId),
            detected.txHash || mint.hash,
            params.signerAddress,
        ]);
        if (wasSeen(execKey)) {
            return {
                detected,
                alertText: 'skipped: duplicate execution',
                executed: false,
            };
        }

        const enriched = await this.enrichWhaleDetection(mint, detected);

        return this.processDetected(enriched, {
            signerAddress: params.signerAddress,
            quantity: params.quantity,
            execute: { privateKeys: params.privateKeys, options: params.options },
            alertMessageId: mint.hash,
            skipPipelineSimulation: getContractMintConfig().copyMintSkipPipelineSim,
        });
    }

    /** Pending mempool txs have no receipt yet — skip receipt fetch for speed. */
    private async enrichWhaleDetection(
        mint: DetectedMint,
        detected: import('./types.js').DetectedContractMint
    ): Promise<import('./types.js').DetectedContractMint> {
        if (mint.detectionPath === 'pending') {
            return detected;
        }
        const receiptDetected = await this.detector.detectFromTxHash(mint.hash, {
            whaleAddress: mint.from,
        });
        return receiptDetected || detected;
    }

    private async processDetected(
        detected: import('./types.js').DetectedContractMint,
        params: {
            signerAddress: string;
            quantity?: number;
            execute?: { privateKeys: string[]; options?: Record<string, unknown> };
            alertMessageId?: string;
            skipPipelineSimulation?: boolean;
        }
    ): Promise<ContractMintPipelineResult> {
        const cfg = getContractMintConfig();
        const skipSim = params.skipPipelineSimulation ?? cfg.copyMintSkipPipelineSim;

        let plan = await buildMintPlan({
            detected,
            signerAddress: params.signerAddress,
            quantity: params.quantity,
            provider: this.provider,
            privateKeyForSign: params.execute?.privateKeys?.[0],
        });

        plan = await this.finalizeCalldata(plan, detected, params.signerAddress);

        if (plan.executable && !skipSim) {
            const sim = await runSimulationGate({
                provider: this.provider,
                from: params.signerAddress,
                to: plan.executionTarget,
                data: plan.calldata,
                value: plan.value,
            });
            plan.simulationStatus = sim.status === 'skipped' && cfg.unsafeOverrideSimulation ? 'passed' : sim.status;
            plan.simulationFailure = sim.failure;
            plan.estimatedGas = sim.gasEstimate;
            if (sim.status === 'failed' && cfg.simulationRequired && !cfg.unsafeOverrideSimulation) {
                plan.executable = false;
                plan.skipReason = `skipped: simulation failed - ${sim.failure || 'unknown'}`;
                plan.reason = sim.revertReason || plan.reason;
            } else if (sim.status === 'passed' || sim.status === 'skipped') {
                plan.executable = true;
            }
        } else if (plan.executable && skipSim) {
            plan.simulationStatus = 'skipped';
        }

        lastPlan = plan;

        let executed = false;
        const executionTxHashes: string[] = [];

        const shouldExec = Boolean(
            params.execute?.privateKeys?.length && plan.executable && !cfg.dryRun
        );

        if (shouldExec && params.execute) {
            const candidate = DetectionEngine.candidateFromTracker({
                hash: detected.txHash || '',
                from: detected.whaleAddress || detected.fromAddress,
                to: plan.executionTarget,
                value: plan.value,
                data: plan.calldata,
                timestamp: Date.now(),
                classificationConfidence: plan.confidence,
                detectionPath: 'confirmed',
            });

            const engineResult = await CopyMintEngine.execute({
                triggerType: 'automint',
                provider: this.provider,
                privateKeys: params.execute.privateKeys,
                candidate,
                paymentPlanValue: plan.value,
                options: {
                    ...params.execute.options,
                    skipClassification: true,
                    skipSimulation: true,
                    paymentPrevalidated: true,
                    allowUnknownPayment: true,
                    whaleAddress: detected.whaleAddress,
                },
            });

            executed = engineResult.submittedCount > 0;
            for (const r of engineResult.receipts) {
                if (r.txHash) executionTxHashes.push(r.txHash);
            }
            plan.actionTaken = executed
                ? `submitted ${engineResult.submittedCount} wallet(s)`
                : `engine: ${CopyMintEngine.getLastSkipReason() || 'no submit'}`;
            if (!executed) {
                plan.skipReason = plan.actionTaken;
            }
        } else if (cfg.dryRun && plan.executable) {
            plan.actionTaken = 'dry-run only';
        }

        const result: ContractMintPipelineResult = {
            detected,
            plan,
            alertText: '',
            executed,
            executionTxHashes,
        };
        result.alertText = formatContractMintAlert(result);
        lastResult = result;
        return result;
    }

    private async finalizeCalldata(
        plan: ContractMintPlan,
        detected: import('./types.js').DetectedContractMint,
        signer: string
    ): Promise<ContractMintPlan> {
        const whale = detected.whaleAddress || detected.fromAddress;
        const resolved = await resolveAbi(plan.tokenContract, this.provider, plan.chainId);
        const rewritten = whale
            ? rewriteMintCalldataForWallet(
                  detected.calldata || plan.calldata,
                  whale,
                  signer,
                  resolved.iface
              )
            : null;
        if (rewritten) return { ...plan, calldata: rewritten, executionTarget: plan.executionTarget };
        return plan;
    }
}
