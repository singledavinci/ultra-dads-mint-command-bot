import { AbiCoder, Interface, Wallet } from 'ethers';
import type { JsonRpcProvider } from 'ethers';
import { isSeaDropRouter, SEADROP_ROUTERS } from '../../services/seaDropBuilder.js';
import type { SignatureMintAttempt, SignatureMintContext, SignatureMintStrategy } from './types.js';
import { openseaDropStrategy } from './openseaDropStrategy.js';

const SEADROP_IFACE = new Interface([
    'function mintSigned(address nftContract, address feeRecipient, address minterIfNotPayer, uint256 quantity, tuple(uint256 mintPrice, uint256 maxTotalMintableByWallet, uint256 startTime, uint256 endTime, uint256 dropStageIndex, uint256 maxTokenSupplyForStage, uint256 feeBps) mintParams, bytes signature)',
]);

const MINT_PARAMS_TYPE = [
    { name: 'mintPrice', type: 'uint256' },
    { name: 'maxTotalMintableByWallet', type: 'uint256' },
    { name: 'startTime', type: 'uint256' },
    { name: 'endTime', type: 'uint256' },
    { name: 'dropStageIndex', type: 'uint256' },
    { name: 'maxTokenSupplyForStage', type: 'uint256' },
    { name: 'feeBps', type: 'uint256' },
];

function randomSalt(): bigint {
    return BigInt('0x' + Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex'));
}

export const seaDropSignedStrategy: SignatureMintStrategy = {
    name: 'seadrop_rebuild_opensea',

    async tryBuild(ctx: SignatureMintContext): Promise<SignatureMintAttempt> {
        const target = ctx.detected.executionTarget.toLowerCase();
        if (!isSeaDropRouter(target)) {
            return { ok: false, method: 'seadrop_rebuild_opensea', reason: 'Not a SeaDrop router tx' };
        }
        const selector = ctx.whaleTxData.slice(0, 10).toLowerCase();
        if (selector !== '0x8a1361b5') {
            return { ok: false, method: 'seadrop_rebuild_opensea', reason: 'Not mintSigned selector' };
        }

        const os = await openseaDropStrategy.tryBuild(ctx);
        if (os.ok && os.plan) {
            return { ...os, method: 'seadrop_rebuild_opensea', reason: `SeaDrop via OpenSea: ${os.reason}` };
        }

        try {
            const parsed = SEADROP_IFACE.parseTransaction({ data: ctx.whaleTxData });
            if (!parsed || parsed.name !== 'mintSigned') {
                return { ok: false, method: 'seadrop_rebuild_opensea', reason: 'Could not decode mintSigned' };
            }

            const nft = String(parsed.args.nftContract);
            const feeRecipient = String(parsed.args.feeRecipient);
            const mp = parsed.args.mintParams;
            const mintParams = {
                mintPrice: BigInt(mp.mintPrice ?? mp[0] ?? 0),
                maxTotalMintableByWallet: BigInt(mp.maxTotalMintableByWallet ?? mp[1] ?? 0),
                startTime: BigInt(mp.startTime ?? mp[2] ?? 0),
                endTime: BigInt(mp.endTime ?? mp[3] ?? 0),
                dropStageIndex: BigInt(mp.dropStageIndex ?? mp[4] ?? 0),
                maxTokenSupplyForStage: BigInt(mp.maxTokenSupplyForStage ?? mp[5] ?? 0),
                feeBps: BigInt(mp.feeBps ?? mp[6] ?? 0),
            };

            const provider = (globalThis as { __sigMintProvider?: JsonRpcProvider }).__sigMintProvider;
            const pk = (globalThis as { __sigMintPk?: string }).__sigMintPk;
            if (!provider || !pk) {
                return {
                    ok: false,
                    method: 'seadrop_eip712_local',
                    reason: 'Local SeaDrop sign requires provider (internal)',
                };
            }

            const wallet = new Wallet(pk, provider);
            const router = target;
            const domain = {
                name: 'SeaDrop',
                version: '1.0',
                chainId: ctx.chainId,
                verifyingContract: router,
            };
            const types = {
                MintParams: MINT_PARAMS_TYPE,
                SignedMint: [
                    { name: 'nftContract', type: 'address' },
                    { name: 'minter', type: 'address' },
                    { name: 'feeRecipient', type: 'address' },
                    { name: 'mintParams', type: 'MintParams' },
                    { name: 'salt', type: 'uint256' },
                ],
            };
            const salt = randomSalt();
            const value = {
                nftContract: nft,
                minter: ctx.signerAddress,
                feeRecipient,
                mintParams,
                salt,
            };
            const signature = await wallet.signTypedData(domain, types, value);

            const coder = AbiCoder.defaultAbiCoder();
            const data =
                '0x8a1361b5' +
                coder
                    .encode(
                        [
                            'address',
                            'address',
                            'address',
                            'uint256',
                            'tuple(uint256,uint256,uint256,uint256,uint256,uint256,uint256)',
                            'bytes',
                        ],
                        [
                            nft,
                            feeRecipient,
                            ctx.signerAddress,
                            BigInt(ctx.quantity),
                            [
                                mintParams.mintPrice,
                                mintParams.maxTotalMintableByWallet,
                                mintParams.startTime,
                                mintParams.endTime,
                                mintParams.dropStageIndex,
                                mintParams.maxTokenSupplyForStage,
                                mintParams.feeBps,
                            ],
                            signature,
                        ]
                    )
                    .slice(2);

            const total = mintParams.mintPrice * BigInt(ctx.quantity);
            const valueHex = total > 0n ? '0x' + total.toString(16) : '0x0';

            return {
                ok: true,
                method: 'seadrop_eip712_local',
                reason: 'SeaDrop mintSigned with locally signed EIP-712 (simulation must pass)',
                plan: {
                    tokenContract: nft.toLowerCase(),
                    executionTarget: router,
                    calldata: data,
                    value: valueHex,
                    functionName: 'mintSigned',
                    selector: '0x8a1361b5',
                    mintType: total > 0n ? 'paid' : 'free',
                    category: 'CONDITIONAL',
                    confidence: 'low',
                },
            };
        } catch (e) {
            return {
                ok: false,
                method: 'seadrop_rebuild_opensea',
                reason: `SeaDrop rebuild failed: ${(e as Error).message?.slice(0, 100)}`,
            };
        }
    },
};