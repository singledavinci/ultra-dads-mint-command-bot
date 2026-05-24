import { Interface, Wallet } from 'ethers';
import type { JsonRpcProvider } from 'ethers';
import { isSeaDropRouter } from '../../services/seaDropBuilder.js';
import type { SignatureMintAttempt, SignatureMintContext, SignatureMintStrategy } from './types.js';

const DIRECT_SIG_IFACE = new Interface([
    'function mintSigned(uint256 quantity, bytes signature)',
    'function mintWithSignature(uint256 quantity, bytes signature)',
    'function signedMint(uint256 quantity, bytes signature)',
    'function claim(uint256 quantity, bytes signature)',
]);

export const genericEip712Strategy: SignatureMintStrategy = {
    name: 'generic_eip712',

    async tryBuild(ctx: SignatureMintContext): Promise<SignatureMintAttempt> {
        if (isSeaDropRouter(ctx.detected.executionTarget)) {
            return { ok: false, method: 'generic_eip712', reason: 'Use SeaDrop strategies' };
        }

        const data = ctx.whaleTxData;
        if (!data || data.length < 10) {
            return { ok: false, method: 'generic_eip712', reason: 'No calldata' };
        }

        let parsed;
        try {
            parsed = DIRECT_SIG_IFACE.parseTransaction({ data });
        } catch {
            return { ok: false, method: 'generic_eip712', reason: 'Not a known signed mint ABI' };
        }
        if (!parsed) {
            return { ok: false, method: 'generic_eip712', reason: 'Parse failed' };
        }

        const provider = (globalThis as { __sigMintProvider?: JsonRpcProvider }).__sigMintProvider;
        const pk = (globalThis as { __sigMintPk?: string }).__sigMintPk;
        if (!provider || !pk) {
            return { ok: false, method: 'generic_eip712', reason: 'No signing wallet configured' };
        }

        const wallet = new Wallet(pk, provider);
        const contract = ctx.detected.tokenContract;
        const domain = {
            name: process.env.SIGNATURE_MINT_EIP712_NAME || 'Mint',
            version: process.env.SIGNATURE_MINT_EIP712_VERSION || '1',
            chainId: ctx.chainId,
            verifyingContract: contract,
        };
        const types = {
            MintRequest: [
                { name: 'to', type: 'address' },
                { name: 'quantity', type: 'uint256' },
            ],
        };
        const message = { to: ctx.signerAddress, quantity: BigInt(ctx.quantity) };

        try {
            const signature = await wallet.signTypedData(domain, types, message);
            const encoded = DIRECT_SIG_IFACE.encodeFunctionData(parsed.name, [
                BigInt(ctx.quantity),
                signature,
            ]);
            const value = ctx.whaleTxValue || '0x0';
            return {
                ok: true,
                method: 'generic_eip712',
                reason: `Self-signed EIP-712 for ${parsed.name} (verify via simulation)`,
                plan: {
                    tokenContract: contract,
                    executionTarget: ctx.detected.executionTarget,
                    calldata: encoded,
                    value,
                    functionName: parsed.name,
                    selector: encoded.slice(0, 10),
                    mintType: BigInt(value) > 0n ? 'paid' : 'free',
                    category: 'CONDITIONAL',
                    confidence: 'low',
                },
            };
        } catch (e) {
            return {
                ok: false,
                method: 'generic_eip712',
                reason: `EIP-712 sign failed: ${(e as Error).message?.slice(0, 80)}`,
            };
        }
    },
};