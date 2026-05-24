import type { JsonRpcProvider, TransactionReceipt, TransactionResponse } from 'ethers';
import { isSeaDropRouter } from '../services/seaDropBuilder.js';
import { pickPrimaryMintLog } from './mintLogParser.js';
import { normalizeContractMintInput, parseEtherscanOrOpenseaUrl } from './inputNormalizer.js';
import type { ContractMintInput, DetectedContractMint } from './types.js';

export class ContractMintDetector {
    constructor(private readonly provider: JsonRpcProvider) {}

    async detectFromInput(raw: ContractMintInput): Promise<DetectedContractMint | null> {
        const input = normalizeContractMintInput(raw);
        if (input.txHash) {
            return this.detectFromTxHash(input.txHash, {
                whaleAddress: input.whaleAddress,
                chainId: input.chainId,
            });
        }
        if (input.rawText) {
            const parsed = parseEtherscanOrOpenseaUrl(input.rawText);
            if (parsed.tx) {
                return this.detectFromTxHash(parsed.tx, {
                    whaleAddress: input.whaleAddress,
                    contractHint: parsed.contract,
                    chainId: input.chainId,
                });
            }
        }
        if (input.contractAddress && input.whaleAddress) {
            return null;
        }
        return null;
    }

    async detectFromTxHash(
        txHash: string,
        opts?: { whaleAddress?: string; contractHint?: string; chainId?: number }
    ): Promise<DetectedContractMint | null> {
        const chainId = opts?.chainId ?? parseInt(process.env.CHAIN_ID || '1', 10);

        let tx: TransactionResponse | null;
        let receipt: TransactionReceipt;
        try {
            tx = await this.provider.getTransaction(txHash);
            if (!tx) return null;
            receipt = (await this.provider.getTransactionReceipt(txHash))!;
            if (!receipt || receipt.status !== 1) return null;
        } catch {
            return null;
        }

        const mintLog = pickPrimaryMintLog(receipt.logs, opts?.whaleAddress);
        if (!mintLog) return null;

        const txTo = (tx.to || '').toLowerCase();
        const isSeaDrop = isSeaDropRouter(txTo);
        let tokenContract = mintLog.tokenContract;
        let seaDropNft: string | undefined;

        if (isSeaDrop) {
            seaDropNft = mintLog.tokenContract;
            tokenContract = opts?.contractHint?.toLowerCase() || mintLog.tokenContract;
        } else if (txTo && txTo !== mintLog.tokenContract) {
            tokenContract = mintLog.tokenContract;
        }

        const data = tx.data || '0x';
        const valueWei = tx.value ? '0x' + BigInt(tx.value).toString(16) : '0x0';

        return {
            chainId,
            tokenContract,
            executionTarget: isSeaDrop ? txTo : mintLog.tokenContract,
            txHash: txHash.toLowerCase(),
            whaleAddress: opts?.whaleAddress?.toLowerCase() || tx.from?.toLowerCase(),
            fromAddress: (tx.from || '').toLowerCase(),
            valueWei,
            calldata: data,
            selector: data.length >= 10 ? data.slice(0, 10).toLowerCase() : '0x',
            tokenStandard: mintLog.tokenStandard,
            quantity: mintLog.quantity || 1,
            mintRecipient: mintLog.to,
            blockNumber: receipt.blockNumber,
            detectionSource: 'tx_receipt',
            isSeaDrop,
            seaDropNftContract: seaDropNft,
        };
    }

    detectFromTrackedTx(params: {
        hash: string;
        from: string;
        to: string;
        value: string;
        data: string;
        chainId?: number;
    }): DetectedContractMint | null {
        if (!params.data || params.data === '0x' || params.data.length < 10) return null;
        const chainId = params.chainId ?? parseInt(process.env.CHAIN_ID || '1', 10);
        const isSeaDrop = isSeaDropRouter(params.to);
        return {
            chainId,
            tokenContract: params.to.toLowerCase(),
            executionTarget: params.to.toLowerCase(),
            txHash: params.hash.toLowerCase(),
            whaleAddress: params.from.toLowerCase(),
            fromAddress: params.from.toLowerCase(),
            valueWei: params.value || '0x0',
            calldata: params.data,
            selector: params.data.slice(0, 10).toLowerCase(),
            tokenStandard: 'unknown',
            quantity: 1,
            detectionSource: 'tracked_wallet',
            isSeaDrop,
        };
    }
}
