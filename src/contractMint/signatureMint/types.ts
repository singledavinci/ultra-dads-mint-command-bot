import type { ContractMintPlan, DetectedContractMint } from '../types.js';

export type SignatureMintMethod =
    | 'scatter_api'
    | 'opensea_drop_api'
    | 'external_api'
    | 'seadrop_rebuild_opensea'
    | 'seadrop_eip712_local'
    | 'generic_eip712'
    | 'none';

export interface SignatureMintContext {
    detected: DetectedContractMint;
    signerAddress: string;
    quantity: number;
    chainId: number;
    whaleTxData: string;
    whaleTxValue: string;
}

export interface SignatureMintAttempt {
    ok: boolean;
    method: SignatureMintMethod;
    reason: string;
    plan?: Partial<ContractMintPlan> & {
        executionTarget: string;
        calldata: string;
        value: string;
    };
}

export interface SignatureMintStrategy {
    readonly name: SignatureMintMethod;
    tryBuild(ctx: SignatureMintContext): Promise<SignatureMintAttempt>;
}
